// ============================================
// content_calendar state machine
//
// Flow:
//   draft → planning_done → selected → copy_done → pending_review → copy_approved → image_ready → approved → published
//                                                              ↓                    ↓
//                                                           rejected           image_retry
//                                                               ↓                    ↓
//                                                            copy_done     image_ready (retry < 3)
//                                                                              approved (retry >= 3 | skip)
//
//   copy_approved also has a direct → approved edge (skip imagery, publish copy-only)
//   image_retry also has → approved edge (escape hatch after max retries)
// ============================================

const STATES = [
  'draft',
  'planning_done',
  'selected',
  'copy_done',
  'pending_review',
  'copy_approved',
  'image_ready',
  'image_retry',
  'approved',
  'rejected',
  'published',
];

const TRANSITIONS = {
  draft: ['planning_done', 'selected'],
  planning_done: ['selected'],
  selected: ['copy_done'],
  copy_done: ['pending_review'],
  pending_review: ['copy_approved', 'rejected'],
  copy_approved: ['image_ready', 'approved'],
  image_ready: ['approved', 'image_retry'],
  image_retry: ['image_ready', 'approved'],
  approved: ['published'],
  rejected: ['copy_done'],
  published: [],
};

function isValidStatus(status) {
  return typeof status === 'string' && STATES.includes(status);
}

function allowedTransitions(status) {
  if (!isValidStatus(status)) {
    throw new Error(
      `Invalid status: "${status}". Valid statuses: ${STATES.join(', ')}`
    );
  }
  return TRANSITIONS[status].slice();
}

function nextStatus(status) {
  const allowed = allowedTransitions(status);
  if (allowed.length === 0) return null;
  return allowed[0];
}

function transition(currentStatus, targetStatus) {
  if (!isValidStatus(currentStatus)) {
    throw new Error(
      `Invalid current status: "${currentStatus}". Valid statuses: ${STATES.join(', ')}`
    );
  }
  if (!isValidStatus(targetStatus)) {
    throw new Error(
      `Invalid target status: "${targetStatus}". Valid statuses: ${STATES.join(', ')}`
    );
  }
  const allowed = TRANSITIONS[currentStatus];
  if (allowed.length === 0) {
    throw new Error(
      `State "${currentStatus}" is terminal — cannot transition to "${targetStatus}"`
    );
  }
  if (!allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid transition: "${currentStatus}" → "${targetStatus}". Allowed from "${currentStatus}": ${allowed.join(', ')}`
    );
  }
  return targetStatus;
}

module.exports = {
  STATES,
  TRANSITIONS,
  isValidStatus,
  allowedTransitions,
  nextStatus,
  transition,
};