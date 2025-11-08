(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-PROJECT-NOT-FOUND (err u101))
(define-constant ERR-REPORT-EXISTS (err u102))
(define-constant ERR-INVALID-HASH (err u103))
(define-constant ERR-ORACLE-MISMATCH (err u104))
(define-constant ERR-MILESTONE-NOT-FOUND (err u105))
(define-constant ERR-REPORT-NOT-VERIFIED (err u106))
(define-constant ERR-INVALID-TIMESTAMP (err u107))
(define-constant ERR-INVALID-METRIC (err u108))
(define-constant ERR-REPORT-FINALIZED (err u109))
(define-constant ERR-INVALID-STATUS (err u110))

(define-data-var report-nonce uint u0)

(define-map reports
  { project-id: uint, report-id: uint }
  {
    title: (string-ascii 120),
    description: (string-utf8 1000),
    data-hash: (buff 32),
    oracle-hash: (buff 32),
    submitter: principal,
    timestamp: uint,
    verified: bool,
    finalized: bool,
    milestone-id: uint,
    kwh-generated: uint,
    households-powered: uint,
    co2-saved-kg: uint
  }
)

(define-map project-milestones
  { project-id: uint, milestone-id: uint }
  {
    target-kwh: uint,
    target-households: uint,
    target-co2: uint,
    reward-amount: uint,
    achieved: bool
  }
)

(define-map project-managers
  uint
  (list 10 principal)
)

(define-read-only (get-report (project-id uint) (report-id uint))
  (map-get? reports { project-id: project-id, report-id: report-id })
)

(define-read-only (get-milestone (project-id uint) (milestone-id uint))
  (map-get? project-milestones { project-id: project-id, milestone-id: milestone-id })
)

(define-read-only (is-manager (project-id uint) (user principal))
  (let ((managers (default-to (list) (map-get? project-managers project-id))))
    (is-some (index-of managers user))
  )
)

(define-private (validate-hash (hash (buff 32)))
  (if (is-eq (len hash) u32)
      (ok true)
      (err ERR-INVALID-HASH)
  )
)

(define-private (validate-timestamp (ts uint))
  (if (<= ts (+ block-height u100))
      (ok true)
      (err ERR-INVALID-TIMESTAMP)
  )
)

(define-private (validate-metrics (kwh uint) (households uint) (co2 uint))
  (and (> kwh u0) (> households u0) (> co2 u0))
)

(define-public (register-project-manager (project-id uint) (manager principal))
  (let ((managers (default-to (list) (map-get? project-managers project-id))))
    (asserts! (or (is-eq tx-sender manager) (is-manager project-id tx-sender)) ERR-NOT-AUTHORIZED)
    (asserts! (< (len managers) u10) ERR-NOT-AUTHORIZED)
    (if (is-some (index-of managers manager))
        (ok false)
        (begin
          (map-set project-managers project-id (append managers manager))
          (ok true)
        )
    )
  )
)

(define-public (define-milestone
    (project-id uint)
    (milestone-id uint)
    (target-kwh uint)
    (target-households uint)
    (target-co2 uint)
    (reward-amount uint)
  )
  (begin
    (asserts! (is-manager project-id tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (is-none (get-milestone project-id milestone-id)) ERR-REPORT-EXISTS)
    (asserts! (validate-metrics target-kwh target-households target-co2) ERR-INVALID-METRIC)
    (map-set project-milestones
      { project-id: project-id, milestone-id: milestone-stone-id }
      {
        target-kwh: target-kwh,
        target-households: target-households,
        target-co2: target-co2,
        reward-amount: reward-amount,
        achieved: false
      }
    )
    (ok true)
  )
)

(define-public (submit-report
    (project-id uint)
    (report-id uint)
    (title (string-ascii 120))
    (description (string-utf8 1000))
    (data-hash (buff 32))
    (oracle-hash (buff 32))
    (milestone-id uint)
    (kwh-generated uint)
    (households-powered uint)
    (co2-saved-kg uint)
  )
  (let (
    (existing (get-report project-id report-id))
    (milestone (unwrap! (get-milestone project-id milestone-id) ERR-MILESTONE-NOT-FOUND))
  )
    (asserts! (is-manager project-id tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (is-none existing) ERR-REPORT-EXISTS)
    (try! (validate-hash data-hash))
    (try! (validate-hash oracle-hash))
    (asserts! (validate-metrics kwh-generated households-powered co2-saved-kg) ERR-INVALID-METRIC)
    (asserts! (validate-timestamp block-height) ERR-INVALID-TIMESTAMP)
    (map-set reports
      { project-id: project-id, report-id: report-id }
      {
        title: title,
        description: description,
        data-hash: data-hash,
        oracle-hash: oracle-hash,
        submitter: tx-sender,
        timestamp: block-height,
        verified: false,
        finalized: false,
        milestone-id: milestone-id,
        kwh-generated: kwh-generated,
        households-powered: households-powered,
        co2-saved-kg: co2-saved-kg
      }
    )
    (var-set report-nonce (+ (var-get report-nonce) u1))
    (print { event: "report-submitted", project-id: project-id, report-id: report-id })
    (ok true)
  )
)

(define-public (verify-report-oracle (project-id uint) (report-id uint) (oracle-hash (buff 32)))
  (let (
    (report (unwrap! (get-report project-id report-id) ERR-REPORT-NOT-FOUND))
  )
    (asserts! (not (get finalized report)) ERR-REPORT-FINALIZED)
    (asserts! (is-eq (get oracle-hash report) oracle-hash) ERR-ORACLE-MISMATCH)
    (map-set reports
      { project-id: project-id, report-id: report-id }
      (merge report { verified: true })
    )
    (print { event: "report-verified", project-id: project-id, report-id: report-id })
    (ok true)
  )
)

(define-public (finalize-report (project-id uint) (report-id uint))
  (let (
    (report (unwrap! (get-report project-id report-id) ERR-REPORT-NOT-FOUND))
    (milestone (unwrap! (get-milestone project-id (get milestone-id report)) ERR-MILESTONE-NOT-FOUND))
  )
    (asserts! (get verified report) ERR-REPORT-NOT-VERIFIED)
    (asserts! (not (get finalized report)) ERR-REPORT-FINALIZED)
    (asserts! (is-manager project-id tx-sender) ERR-NOT-AUTHORIZED)
    (let (
      (kwh-ok (>= (get kwh-generated report) (get target-kwh milestone)))
      (house-ok (>= (get households-powered report) (get target-households milestone)))
      (co2-ok (>= (get co2-saved-kg report) (get target-co2 milestone)))
      (all-met (and kwh-ok house-ok co2-ok))
    )
      (map-set reports
        { project-id: project-id, report-id: report-id }
        (merge report { finalized: true })
      )
      (if all-met
          (begin
            (map-set project-milestones
              { project-id: project-id, milestone-id: (get milestone-id report) }
              (merge milestone { achieved: true })
            )
            (print { event: "milestone-achieved", project-id: project-id, milestone-id: (get milestone-id report) })
          )
          (print { event: "milestone-partial", project-id: project-id, milestone-id: (get milestone-id report) })
      )
      (ok all-met)
    )
  )
)

(define-public (update-report-metrics
    (project-id uint)
    (report-id uint)
    (kwh-generated uint)
    (households-powered uint)
    (co2-saved-kg uint)
  )
  (let ((report (unwrap! (get-report project-id report-id) ERR-REPORT-NOT-FOUND)))
    (asserts! (is-manager project-id tx-sender) ERR-NOT-AUTHORIZED)
    (asserts! (not (get verified report)) ERR-REPORT-NOT-VERIFIED)
    (asserts! (validate-metrics kwh-generated households-powered co2-saved-kg) ERR-INVALID-METRIC)
    (map-set reports
      { project-id: project-id, report-id: report-id }
      (merge report {
        kwh-generated: kwh-generated,
        households-powered: households-powered,
        co2-saved-kg: co2-saved-kg
      })
    )
    (ok true)
  )
)

(define-read-only (get-total-reports)
  (ok (var-get report-nonce))
)

(define-read-only (get-achieved-milestones (project-id uint))
  (filter
    (lambda (mid uint) (default-to false (get achieved (get-milestone project-id mid))))
    (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9)
  )
)