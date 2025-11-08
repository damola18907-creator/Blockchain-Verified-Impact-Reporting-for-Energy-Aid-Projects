;; DonationHandler.clar

(define-constant ERR-NOT-AUTHORIZED (err u200))
(define-constant ERR-PROJECT-NOT-FOUND (err u201))
(define-constant ERR-INSUFFICIENT-BALANCE (err u202))
(define-constant ERR-MILESTONE-NOT-ACHIEVED (err u203))
(define-constant ERR-DONATION-ZERO (err u204))
(define-constant ERR-PROJECT-CLOSED (err u205))
(define-constant ERR-REPORT-SUBMISSION-REQUIRED (err u206))
(define-constant ERR-INVALID-AMOUNT (err u207))
(define-constant ERR-ESCROW-LOCKED (err u208))

(define-data-var contract-owner principal tx-sender)

(define-map projects
  uint
  {
    active: bool,
    goal-amount: uint,
    raised-amount: uint,
    donor-count: uint,
    last-milestone-id: uint,
    escrow-balance: uint,
    report-submission-contract: principal
  }
)

(define-map donations
  { project-id: uint, donor: principal }
  {
    amount: uint,
    timestamp: uint,
    refunded: bool
  }
)

(define-map escrow-releases
  { project-id: uint, milestone-id: uint }
  {
    amount-released: uint,
    released-at: uint,
    triggered-by: principal
  }
)

(define-read-only (get-project (project-id uint))
  (map-get? projects project-id)
)

(define-read-only (get-donation (project-id uint) (donor principal))
  (map-get? donations { project-id: project-id, donor: donor })
)

(define-read-only (get-escrow-release (project-id uint) (milestone-id uint))
  (map-get? escrow-releases { project-id: project-id, milestone-id: milestone-id })
)

(define-read-only (get-contract-balance)
  (stx-get-balance (as-contract tx-sender))
)

(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

(define-private (validate-amount (amount uint))
  (and (> amount u0) (<= amount u1000000000000))
)

(define-public (initialize-project
    (project-id uint)
    (goal-amount uint)
    (report-contract principal)
  )
  (begin
    (asserts! (is-owner) ERR-NOT-AUTHORIZED)
    (asserts! (validate-amount goal-amount) ERR-INVALID-AMOUNT)
    (asserts! (is-none (get-project project-id)) ERR-PROJECT-NOT-FOUND)
    (map-set projects project-id
      {
        active: true,
        goal-amount: goal-amount,
        raised-amount: u0,
        donor-count: u0,
        last-milestone-id: u0,
        escrow-balance: u0,
        report-submission-contract: report-contract
      }
    )
    (ok true)
  )
)

(define-public (donate (project-id uint) (amount uint))
  (let (
    (project (unwrap! (get-project project-id) ERR-PROJECT-NOT-FOUND))
  )
    (asserts! (get active project) ERR-PROJECT-CLOSED)
    (asserts! (validate-amount amount) ERR-DONATION-ZERO)
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (let (
      (current-donation (default-to u0 (get amount (get-donation project-id tx-sender))))
      (new-total (+ current-donation amount))
      (updated-raised (+ (get raised-amount project) amount))
      (updated-count (if (is-eq current-donation u0) (+ (get donor-count project) u1) (get donor-count project)))
    )
      (map-set donations
        { project-id: project-id, donor: tx-sender }
        { amount: new-total, timestamp: block-height, refunded: false }
      )
      (map-set projects project-id
        (merge project {
          raised-amount: updated-raised,
          donor-count: updated-count,
          escrow-balance: (+ (get escrow-balance project) amount)
        })
      )
      (print { event: "donation-received", project-id: project-id, donor: tx-sender, amount: amount })
      (ok true)
    )
  )
)

(define-public (release-funds-on-milestone
    (project-id uint)
    (milestone-id uint)
    (release-amount uint)
  )
  (let (
    (project (unwrap! (get-project project-id) ERR-PROJECT-NOT-FOUND))
    (report-contract (get report-submission-contract project))
    (escrow-balance (get escrow-balance project))
  )
    (asserts! (get active project) ERR-PROJECT-CLOSED)
    (asserts! (>= escrow-balance release-amount) ERR-INSUFFICIENT-BALANCE)
    (asserts! (validate-amount release-amount) ERR-INVALID-AMOUNT)
    (let (
      (milestone-response (contract-call? report-contract get-milestone project-id milestone-id))
      (milestone (unwrap! milestone-response ERR-MILESTONE-NOT-ACHIEVED))
    )
      (asserts! (get achieved milestone) ERR-MILESTONE-NOT-ACHIEVED)
      (asserts! (is-none (get-escrow-release project-id milestone-id)) ERR-ESCROW-LOCKED)
      (try! (as-contract (stx-transfer? release-amount tx-sender tx-sender)))
      (map-set escrow-releases
        { project-id: project-id, milestone-id: milestone-id }
        { amount-released: release-amount, released-at: block-height, triggered-by: tx-sender }
      )
      (map-set projects project-id
        (merge project { escrow-balance: (- escrow-balance release-amount) })
      )
      (print { event: "funds-released", project-id: project-id, milestone-id: milestone-id, amount: release-amount })
      (ok true)
    )
  )
)

(define-public (close-project (project-id uint))
  (let ((project (unwrap! (get-project project-id) ERR-PROJECT-NOT-FOUND)))
    (asserts! (is-owner) ERR-NOT-AUTHORIZED)
    (asserts! (get active project) ERR-PROJECT-CLOSED)
    (let ((escrow (get escrow-balance project)))
      (map-set projects project-id (merge project { active: false }))
      (if (> escrow u0)
          (try! (as-contract (stx-transfer? escrow tx-sender tx-sender)))
          (ok true)
      )
      (print { event: "project-closed", project-id: project-id, remaining-escrow: escrow })
      (ok true)
    )
  )
)

(define-public (refund-donor (project-id uint) (donor principal))
  (let (
    (project (unwrap! (get-project project-id) ERR-PROJECT-NOT-FOUND))
    (donation (unwrap! (get-donation project-id donor) ERR-INSUFFICIENT-BALANCE))
  )
    (asserts! (is-owner) ERR-NOT-AUTHORIZED)
    (asserts! (not (get active project)) ERR-PROJECT-CLOSED)
    (asserts! (not (get refunded donation)) ERR-INSUFFICIENT-BALANCE)
    (let ((amount (get amount donation)))
      (asserts! (>= (get escrow-balance project) amount) ERR-INSUFFICIENT-BALANCE)
      (try! (as-contract (stx-transfer? amount tx-sender donor)))
      (map-set donations
        { project-id: project-id, donor: donor }
        (merge donation { refunded: true })
      )
      (map-set projects project-id
        (merge project { escrow-balance: (- (get escrow-balance project) amount) })
      )
      (print { event: "donor-refunded", project-id: project-id, donor: donor, amount: amount })
      (ok true)
    )
  )
)

(define-read-only (get-total-donors (project-id uint))
  (ok (get donor-count (unwrap! (get-project project-id) ERR-PROJECT-NOT-FOUND)))
)

(define-read-only (get-raised-vs-goal (project-id uint))
  (let ((project (unwrap! (get-project project-id) ERR-PROJECT-NOT-FOUND)))
    (ok { raised: (get raised-amount project), goal: (get goal-amount project) })
  )
)