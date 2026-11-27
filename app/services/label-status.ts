// Shared by server code and the admin UI (no server imports here).
//
// ReturnLabel.status:
//   sending       a Ship call is in progress (acts as the lock)
//   created       label ready (tracking webhooks may later overwrite it with carrier statuses)
//   failed        ShippyPro rejected the shipment, or it was never sent: safe to try again
//   unknown       Ship was sent but the outcome is unknown: a shipment MAY exist
//   needs_review  ShippyPro created a shipment but returned no label file
//   voided        voided with ShippyPro: safe to try again
// Only `failed`, `voided` and the legacy default `pending` allow a new Ship call.
export const RETRYABLE_LABEL_STATUSES = ["failed", "voided", "pending"];
