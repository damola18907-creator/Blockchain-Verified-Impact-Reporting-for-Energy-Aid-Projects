;; ImpactOracle.clar

(define-constant ERR-NOT-AUTHORIZED (err u300))
(define-constant ERR-ORACLE-NOT-REGISTERED (err u301))
(define-constant ERR-DATA-EXISTS (err u302))
(define-constant ERR-INVALID-HASH (err u303))
(define-constant ERR-PROJECT-NOT-FOUND (err u304))
(define-constant ERR-TIMESTAMP-STALE (err u305))
(define-constant ERR-INVALID-METRIC (err u306))
(define-constant ERR-ORACLE-REVOKED (err u307))

(define-data-var contract-owner principal tx-sender)
(define-data-var oracle-nonce uint u0)

(define-map registered-oracles
  principal
  {
    name: (string-ascii 60),
    active: bool,
    data-count: uint,
    last-submission: uint
  }
)

(define-map oracle-data
  { project-id: uint, submission-id: uint }
  {
    oracle: principal,
    data-hash: (buff 32),
    kwh: uint,
    households: uint,
    co2-kg: uint,
    timestamp: uint,
    signature-valid: bool
  }
)

(define-map project-oracle-assignments
  { project-id: uint, oracle: principal }
  bool
)

(define-read-only (get-oracle (oracle principal))
  (map-get? registered-oracles oracle)
)

(define-read-only (get-oracle-data (project-id uint) (submission-id uint))
  (map-get? oracle-data { project-id: project-id, submission-id: submission-id })
)

(define-read-only (is-oracle-assigned (project-id uint) (oracle principal))
  (default-to false (map-get? project-oracle-assignments { project-id: project-id, oracle: oracle }))
)

(define-read-only (get-total-submissions)
  (ok (var-get oracle-nonce))
)

(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

(define-private (validate-hash (hash (buff 32)))
  (is-eq (len hash) u32)
)

(define-private (validate-metrics (kwh uint) (households uint) (co2 uint))
  (and (> kwh u0) (> households u0) (> co2 u0))
)

(define-private (validate-timestamp (ts uint))
  (>= ts (- block-height u100))
)

(define-public (register-oracle (name (string-ascii 60)))
  (let ((existing (get-oracle tx-sender)))
    (asserts! (is-owner) ERR-NOT-AUTHORIZED)
    (asserts! (is-none existing) ERR-ORACLE-NOT-REGISTERED)
    (map-set registered-oracles tx-sender
      { name: name, active: true, data-count: u0, last-submission: u0 }
    )
    (print { event: "oracle-registered", oracle: tx-sender, name: name })
    (ok true)
  )
)

(define-public (revoke-oracle (oracle principal))
  (let ((info (unwrap! (get-oracle oracle) ERR-ORACLE-NOT-REGISTERED)))
    (asserts! (is-owner) ERR-NOT-AUTHORIZED)
    (map-set registered-oracles oracle (merge info { active: false }))
    (print { event: "oracle-revoked", oracle: oracle })
    (ok true)
  )
)

(define-public (assign-oracle-to-project (project-id uint) (oracle principal))
  (let ((oracle-info (unwrap! (get-oracle oracle) ERR-ORACLE-NOT-REGISTERED)))
    (asserts! (is-owner) ERR-NOT-AUTHORIZED)
    (asserts! (get active oracle-info) ERR-ORACLE-REVOKED)
    (map-set project-oracle-assignments { project-id: project-id, oracle: oracle } true)
    (print { event: "oracle-assigned", project-id: project-id, oracle: oracle })
    (ok true)
  )
)

(define-public (submit-oracle-data
    (project-id uint)
    (submission-id uint)
    (data-hash (buff 32))
    (kwh uint)
    (households uint)
    (co2-kg uint)
  )
  (let (
    (oracle-info (unwrap! (get-oracle tx-sender) ERR-ORACLE-NOT-REGISTERED))
    (existing (get-oracle-data project-id submission-id))
  )
    (asserts! (get active oracle-info) ERR-ORACLE-REVOKED)
    (asserts! (is-oracle-assigned project-id tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (is-none existing) ERR-DATA-EXISTS)
    (asserts! (validate-hash data-hash) ERR-INVALID-HASH)
    (asserts! (validate-metrics kwh households co2-kg) ERR-INVALID-METRIC)
    (asserts! (validate-timestamp block-height) ERR-TIMESTAMP-STALE)
    (map-set oracle-data
      { project-id: project-id, submission-id: submission-id }
      {
        oracle: tx-sender,
        data-hash: data-hash,
        kwh: kwh,
        households: households,
        co2-kg: co2-kg,
        timestamp: block-height,
        signature-valid: true
      }
    )
    (map-set registered-oracles tx-sender
      (merge oracle-info {
        data-count: (+ (get data-count oracle-info) u1),
        last-submission: block-height
      })
    )
    (var-set oracle-nonce (+ (var-get oracle-nonce) u1))
    (print { event: "oracle-data-submitted", project-id: project-id, submission-id: submission-id, oracle: tx-sender })
    (ok true)
  )
)

(define-public (update-oracle-data
    (project-id uint)
    (submission-id uint)
    (kwh uint)
    (households uint)
    (co2-kg uint)
  )
  (let (
    (data (unwrap! (get-oracle-data project-id submission-id) ERR-PROJECT-NOT-FOUND))
  )
    (asserts! (is-eq (get oracle data) tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (validate-metrics kwh households co2-kg) ERR-INVALID-METRIC)
    (map-set oracle-data
      { project-id: project-id, submission-id: submission-id }
      (merge data { kwh: kwh, households: households, co2-kg: co2-kg })
    )
    (print { event: "oracle-data-updated", project-id: project-id, submission-id: submission-id })
    (ok true)
  )
)

(define-read-only (get-oracle-hash-for-report (project-id uint) (submission-id uint))
  (match (get-oracle-data project-id submission-id)
    data (ok (get data-hash data))
    (err ERR-PROJECT-NOT-FOUND)
  )
)

(define-read-only (get-latest-oracle-submission (project-id uint))
  (let ((submissions (filter
        (lambda (sid uint) (is-some (get-oracle-data project-id sid)))
        (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9)
      )))
    (if (> (len submissions) u0)
        (ok (unwrap! (get-oracle-data project-id (fold max submissions u0)) ERR-PROJECT-NOT-FOUND))
        (err ERR-PROJECT-NOT-FOUND)
    )
  )
)