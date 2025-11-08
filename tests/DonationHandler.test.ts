// DonationHandler.test.ts

import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 200;
const ERR_PROJECT_NOT_FOUND = 201;
const ERR_INSUFFICIENT_BALANCE = 202;
const ERR_MILESTONE_NOT_ACHIEVED = 203;
const ERR_DONATION_ZERO = 204;
const ERR_PROJECT_CLOSED = 205;
const ERR_ESCROW_LOCKED = 208;

interface Project {
  active: boolean;
  goalAmount: bigint;
  raisedAmount: bigint;
  donorCount: bigint;
  lastMilestoneId: bigint;
  escrowBalance: bigint;
  reportSubmissionContract: string;
}

interface Donation {
  amount: bigint;
  timestamp: bigint;
  refunded: boolean;
}

interface EscrowRelease {
  amountReleased: bigint;
  releasedAt: bigint;
  triggeredBy: string;
}

interface MockState {
  contractOwner: string;
  projects: Map<bigint, Project>;
  donations: Map<string, Donation>;
  escrowReleases: Map<string, EscrowRelease>;
  contractBalance: bigint;
  blockHeight: bigint;
  caller: string;
  events: any[];
  reportContractMock: any;
}

class DonationHandlerMock {
  state: MockState = {
    contractOwner: "ST1OWNER",
    projects: new Map(),
    donations: new Map(),
    escrowReleases: new Map(),
    contractBalance: 0n,
    blockHeight: 100n,
    caller: "ST1OWNER",
    events: [],
    reportContractMock: {
      getMilestone: (_projectId: bigint, milestoneId: bigint) => ({
        achieved: milestoneId === 0n ? true : false,
      }),
    },
  };

  reset() {
    this.state = {
      contractOwner: "ST1OWNER",
      projects: new Map(),
      donations: new Map(),
      escrowReleases: new Map(),
      contractBalance: 0n,
      blockHeight: 100n,
      caller: "ST1OWNER",
      events: [],
      reportContractMock: { getMilestone: () => ({ achieved: true }) },
    };
  }

  setCaller(caller: string) {
    this.state.caller = caller;
  }

  setReportContractMock(mock: any) {
    this.state.reportContractMock = mock;
  }

  initializeProject(
    projectId: bigint,
    goalAmount: bigint,
    reportContract: string
  ): { ok: boolean; value: boolean } {
    if (this.state.caller !== this.state.contractOwner)
      return { ok: false, value: false };
    if (goalAmount <= 0n || goalAmount > 1000000000000n)
      return { ok: false, value: false };
    if (this.state.projects.has(projectId)) return { ok: false, value: false };
    this.state.projects.set(projectId, {
      active: true,
      goalAmount,
      raisedAmount: 0n,
      donorCount: 0n,
      lastMilestoneId: 0n,
      escrowBalance: 0n,
      reportSubmissionContract: reportContract,
    });
    return { ok: true, value: true };
  }

  donate(projectId: bigint, amount: bigint): { ok: boolean; value: boolean } {
    const project = this.state.projects.get(projectId);
    if (!project || !project.active)
      return { ok: false, value: ERR_PROJECT_CLOSED };
    if (amount <= 0n || amount > 1000000000000n)
      return { ok: false, value: ERR_DONATION_ZERO };
    const key = `${projectId}-${this.state.caller}`;
    const current = this.state.donations.get(key)?.amount || 0n;
    const newTotal = current + amount;
    const donorCount =
      current === 0n ? project.donorCount + 1n : project.donorCount;
    this.state.donations.set(key, {
      amount: newTotal,
      timestamp: this.state.blockHeight,
      refunded: false,
    });
    this.state.projects.set(projectId, {
      ...project,
      raisedAmount: project.raisedAmount + amount,
      donorCount,
      escrowBalance: project.escrowBalance + amount,
    });
    this.state.contractBalance += amount;
    this.state.events.push({
      event: "donation-received",
      projectId,
      donor: this.state.caller,
      amount,
    });
    return { ok: true, value: true };
  }

  releaseFundsOnMilestone(
    projectId: bigint,
    milestoneId: bigint,
    releaseAmount: bigint
  ): { ok: boolean; value: boolean } {
    const project = this.state.projects.get(projectId);
    if (!project || !project.active)
      return { ok: false, value: ERR_PROJECT_CLOSED };
    if (project.escrowBalance < releaseAmount)
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (releaseAmount <= 0n || releaseAmount > 1000000000000n)
      return { ok: false, value: false };
    const milestone = this.state.reportContractMock.getMilestone(
      projectId,
      milestoneId
    );
    if (!milestone.achieved)
      return { ok: false, value: ERR_MILESTONE_NOT_ACHIEVED };
    const releaseKey = `${projectId}-${milestoneId}`;
    if (this.state.escrowReleases.has(releaseKey))
      return { ok: false, value: ERR_ESCROW_LOCKED };
    this.state.escrowReleases.set(releaseKey, {
      amountReleased: releaseAmount,
      releasedAt: this.state.blockHeight,
      triggeredBy: this.state.caller,
    });
    this.state.projects.set(projectId, {
      ...project,
      escrowBalance: project.escrowBalance - releaseAmount,
    });
    this.state.contractBalance -= releaseAmount;
    this.state.events.push({
      event: "funds-released",
      projectId,
      milestoneId,
      amount: releaseAmount,
    });
    return { ok: true, value: true };
  }

  closeProject(projectId: bigint): { ok: boolean; value: boolean } {
    if (this.state.caller !== this.state.contractOwner)
      return { ok: false, value: false };
    const project = this.state.projects.get(projectId);
    if (!project || !project.active)
      return { ok: false, value: ERR_PROJECT_CLOSED };
    const escrow = project.escrowBalance;
    this.state.projects.set(projectId, { ...project, active: false });
    if (escrow > 0n) this.state.contractBalance -= escrow;
    this.state.events.push({
      event: "project-closed",
      projectId,
      remainingEscrow: escrow,
    });
    return { ok: true, value: true };
  }

  refundDonor(
    projectId: bigint,
    donor: string
  ): { ok: boolean; value: boolean } {
    if (this.state.caller !== this.state.contractOwner)
      return { ok: false, value: false };
    const project = this.state.projects.get(projectId);
    if (!project || project.active)
      return { ok: false, value: ERR_PROJECT_CLOSED };
    const key = `${projectId}-${donor}`;
    const donation = this.state.donations.get(key);
    if (!donation || donation.refunded)
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    if (project.escrowBalance < donation.amount)
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.donations.set(key, { ...donation, refunded: true });
    this.state.projects.set(projectId, {
      ...project,
      escrowBalance: project.escrowBalance - donation.amount,
    });
    this.state.contractBalance -= donation.amount;
    this.state.events.push({
      event: "donor-refunded",
      projectId,
      donor,
      amount: donation.amount,
    });
    return { ok: true, value: true };
  }

  getProject(projectId: bigint): Project | null {
    return this.state.projects.get(projectId) || null;
  }

  getDonation(projectId: bigint, donor: string): Donation | null {
    return this.state.donations.get(`${projectId}-${donor}`) || null;
  }

  getTotalDonors(projectId: bigint): { ok: boolean; value: bigint } {
    const project = this.state.projects.get(projectId);
    return project
      ? { ok: true, value: project.donorCount }
      : { ok: false, value: 0n };
  }

  getRaisedVsGoal(projectId: bigint): {
    ok: boolean;
    value: { raised: bigint; goal: bigint };
  } {
    const project = this.state.projects.get(projectId);
    return project
      ? {
          ok: true,
          value: { raised: project.raisedAmount, goal: project.goalAmount },
        }
      : { ok: false, value: { raised: 0n, goal: 0n } };
  }
}

describe("DonationHandler", () => {
  let mock: DonationHandlerMock;

  beforeEach(() => {
    mock = new DonationHandlerMock();
    mock.reset();
  });

  it("initializes project successfully", () => {
    const result = mock.initializeProject(1n, 10000n, "ST_REPORT");
    expect(result.ok).toBe(true);
    const project = mock.getProject(1n);
    expect(project?.active).toBe(true);
    expect(project?.goalAmount).toBe(10000n);
  });

  it("accepts donation and updates state", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1DONOR");
    const result = mock.donate(1n, 500n);
    expect(result.ok).toBe(true);
    const project = mock.getProject(1n);
    expect(project?.raisedAmount).toBe(500n);
    expect(project?.donorCount).toBe(1n);
    expect(project?.escrowBalance).toBe(500n);
    expect(mock.state.events[0].event).toBe("donation-received");
  });

  it("aggregates multiple donations from same donor", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1DONOR");
    mock.donate(1n, 300n);
    mock.donate(1n, 700n);
    const donation = mock.getDonation(1n, "ST1DONOR");
    expect(donation?.amount).toBe(1000n);
    const project = mock.getProject(1n);
    expect(project?.donorCount).toBe(1n);
  });

  it("releases funds when milestone achieved", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1DONOR");
    mock.donate(1n, 2000n);
    mock.setCaller("ST1MANAGER");
    const result = mock.releaseFundsOnMilestone(1n, 0n, 1000n);
    expect(result.ok).toBe(true);
    const project = mock.getProject(1n);
    expect(project?.escrowBalance).toBe(1000n);
    expect(mock.state.events).toContainEqual(
      expect.objectContaining({ event: "funds-released", milestoneId: 0n })
    );
  });

  it("prevents double release on same milestone", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1DONOR");
    mock.donate(1n, 3000n);
    mock.setCaller("ST1MANAGER");
    mock.releaseFundsOnMilestone(1n, 0n, 1000n);
    const result = mock.releaseFundsOnMilestone(1n, 0n, 1000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ESCROW_LOCKED);
  });

  it("refunds donor after project closure", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1DONOR");
    mock.donate(1n, 800n);
    mock.setCaller("ST1OWNER");
    mock.closeProject(1n);
    const result = mock.refundDonor(1n, "ST1DONOR");
    expect(result.ok).toBe(true);
    const donation = mock.getDonation(1n, "ST1DONOR");
    expect(donation?.refunded).toBe(true);
  });

  it("rejects refund if project still active", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1DONOR");
    mock.donate(1n, 800n);
    mock.setCaller("ST1OWNER");
    const result = mock.refundDonor(1n, "ST1DONOR");
    expect(result.ok).toBe(false);
  });

  it("returns correct donor count and progress", () => {
    mock.initializeProject(1n, 10000n, "ST_REPORT");
    mock.setCaller("ST1A");
    mock.donate(1n, 1000n);
    mock.setCaller("ST1B");
    mock.donate(1n, 2000n);
    const donors = mock.getTotalDonors(1n);
    const progress = mock.getRaisedVsGoal(1n);
    expect(donors.value).toBe(2n);
    expect(progress.value.raised).toBe(3000n);
    expect(progress.value.goal).toBe(10000n);
  });
});
