// Pre-warmed FIFO pool of Google Meet links.
//
// Two fill points, nothing time-based:
//   1. App boot      -> start() fills TARGET links in the background.
//   2. OAuth connect -> refillInBackground() fills (warmup before connect
//      has nothing to fill with, since Google isn't connected yet).
//
// Steady state: each slash request dequeues one link and triggers one
// background creation, so the pool stays full. If the pool is empty
// (still warming, burst traffic, Google error), callers create on demand.

const DEFAULT_SIZE = 10;

let targetSize = Number(process.env.MEET_CACHE_SIZE) || DEFAULT_SIZE;
if (!Number.isFinite(targetSize) || targetSize < 1) targetSize = DEFAULT_SIZE;

let createFn = null; // async () => meetingUri
const queue = []; // FIFO of { link, createdAt }
let inFlight = 0; // background creations currently running
let started = false;

function status() {
	return {
		enabled: Boolean(createFn),
		targetSize,
		cached: queue.length,
		inFlight,
		started,
	};
}

function configure({target, create} = {}) {
	if (Number.isFinite(Number(target)) && Number(target) >= 1) {
		targetSize = Math.floor(Number(target));
	}
	if (typeof create === "function") createFn = create;
	return status();
}

// Dequeue one link, or null when the pool is empty.
function take() {
	const entry = queue.shift();
	return entry ? entry.link : null;
}

// Top the pool back up to targetSize. Fire-and-forget: never throws,
// never blocks the caller. `inFlight` guards against over-provisioning
// when several requests trigger a refill at the same time.
function refillInBackground() {
	if (!createFn || !started) return;

	const needed = targetSize - queue.length - inFlight;
	if (needed <= 0) return;

	console.log(`Need ${needed} item in Q`);
	for (let i = 0; i < needed; i++) {
		inFlight++;
		createFn().then(
			(link) => {
				if (typeof link === "string" && link) {
					queue.push({link, createdAt: new Date().toISOString()});
				}
				inFlight--;
				// A dequeue may have happened while we were creating — top up again.
				if (queue.length + inFlight < targetSize) refillInBackground();
			},
			(err) => {
				inFlight--;
				console.error("[meet-cache] background refill failed:", (err && err.message) || err);
			}
		);
	}
	console.log("Prefill completed");
}

// Initial fill of TARGET links in the background.
// Returns immediately so boot is never blocked.
function start() {
	if (!started) {
		started = true;
		console.log(`[meet-cache] warming up ${targetSize} Meet links in background…`);
	}
	refillInBackground();
	return status();
}

function _resetForTests() {
	queue.length = 0;
	inFlight = 0;
	started = false;
	createFn = null;
}

module.exports = {configure, start, take, refillInBackground, status};
module.exports._resetForTests = _resetForTests;
module.exports._queueForTests = queue;
