import { describe, it, expect, beforeEach } from "vitest";
import { buffCV, uintCV, stringAsciiCV, stringUtf8CV, tupleCV, listCV, principalCV, someCV, noneCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_PROJECT_NOT_FOUND = 101;
const ERR_REPORT_EXISTS = 102;
const ERR_INVALID_HASH = 103;
const ERR_ORACLE_MISMATCH = 104;
const ERR_MILESTONE_NOT_FOUND = 105;
const ERR_REPORT_NOT_VERIFIED = 106;
const ERR_INVALID_TIMESTAMP = 107;
const ERR_INVALID_METRIC = 108;
const ERR_REPORT_FINALIZED = 109;

interface Report {
  title: string;
  description: string;
  "data-hash": Buffer;
  "oracle-hash": Buffer;
  submitter: string;
  timestamp: bigint;
  verified: boolean;
  finalized: boolean;
  "milestone-id": bigint;
  "kwh-generated": bigint;
  "households-powered": bigint;
  "co2-saved-kg": bigint;
}

interface Milestone {
  "target-kwh": bigint;
  "target-households": bigint;
  "target-co2": bigint;
  "reward-amount": bigint;
  achieved: boolean;
}

interface MockState {
  reportNonce: bigint;
  reports: Map<string, Report>;
  milestones: Map<string, Milestone>;
  managers: Map<bigint, string[]>;
  blockHeight: bigint;
  caller: string;
  events: any[];
}

class ReportSubmissionMock {
  state: MockState = {
    reportNonce: 0n,
    reports: new Map(),
    milestones: new Map(),
    managers: new Map(),
    blockHeight: 100n,
    caller: "ST1TEST",
    events: [],
  };

  reset() {
    this.state = {
      reportNonce: 0n,
      reports: new Map(),
      milestones: new Map(),
      managers: new Map(),
      blockHeight: 100n,
      caller: "ST1TEST",
      events: [],
    };
  }

  setCaller(caller: string) {
    this.state.caller = caller;
  }

  setBlockHeight(height: bigint) {
    this.state.blockHeight = height;
  }

  isManager(projectId: bigint, user: string): boolean {
    const managers = this.state.managers.get(projectId) || [];
    return managers.includes(user) || user === this.state.caller;
  }

  registerProjectManager(projectId: bigint, manager: string): { ok: boolean; value: boolean } {
    if (!this.isManager(projectId, this.state.caller) && this.state.caller !== manager) {
      return { ok: false, value: false };
    }
    const managers = this.state.managers.get(projectId) || [];
    if (managers.length >= 10) return { ok: false, value: false };
    if (managers.includes(manager)) return { ok: true, value: false };
    this.state.managers.set(projectId, [...managers, manager]);
    return { ok: true, value: true };
  }

  defineMilestone(
    projectId: bigint,
    milestoneId: bigint,
    targetKwh: bigint,
    targetHouseholds: bigint,
    targetCo2: bigint,
    rewardAmount: bigint
  ): { ok: boolean; value: boolean } {
    if (!this.isManager(projectId, this.state.caller)) return { ok: false, value: false };
    const key = `${projectId}-${milestoneId}`;
    if (this.state.milestones.has(key)) return { ok: false, value: false };
    if (targetKwh <= 0n || targetHouseholds <= 0n || targetCo2 <= 0n) return { ok: false, value: false };
    this.state.milestones.set(key, {
      "target-kwh": targetKwh,
      "target-households": targetHouseholds,
      "target-co2": targetCo2,
      "reward-amount": rewardAmount,
      achieved: false,
    });
    return { ok: true, value: true };
  }

  submitReport(
    projectId: bigint,
    reportId: bigint,
    title: string,
    description: string,
    dataHash: Buffer,
    oracleHash: Buffer,
    milestoneId: bigint,
    kwhGenerated: bigint,
    householdsPowered: bigint,
    co2SavedKg: bigint
  ): { ok: boolean; value: boolean } {
    if (!this.isManager(projectId, this.state.caller)) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const key = `${projectId}-${reportId}`;
    if (this.state.reports.has(key)) return { ok: false, value: ERR_REPORT_EXISTS };
    if (dataHash.length !== 32 || oracleHash.length !== 32) return { ok: false, value: ERR_INVALID_HASH };
    if (kwhGenerated <= 0n || householdsPowered <= 0n || co2SavedKg <= 0n) return { ok: false, value: ERR_INVALID_METRIC };
    if (this.state.blockHeight > this.state.blockHeight + 100n) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    const mkey = `${projectId}-${milestoneId}`;
    if (!this.state.milestones.has(mkey)) return { ok: false, value: ERR_MILESTONE_NOT_FOUND };

    this.state.reports.set(key, {
      title,
      description,
      "data-hash": dataHash,
      "oracle-hash": oracleHash,
      submitter: this.state.caller,
      timestamp: this.state.blockHeight,
      verified: false,
      finalized: false,
      "milestone-id": milestoneId,
      "kwh-generated": kwhGenerated,
      "households-powered": householdsPowered,
      "co2-saved-kg": co2SavedKg,
    });
    this.state.reportNonce += 1n;
    this.state.events.push({ event: "report-submitted", projectId, reportId });
    return { ok: true, value: true };
  }

  verifyReportOracle(projectId: bigint, reportId: bigint, oracleHash: Buffer): { ok: boolean; value: boolean } {
    const key = `${projectId}-${reportId}`;
    const report = this.state.reports.get(key);
    if (!report) return { ok: false, value: ERR_PROJECT_NOT_FOUND };
    if (report.finalized) return { ok: false, value: ERR_REPORT_FINALIZED };
    if (!Buffer.from(report["oracle-hash"]).equals(oracleHash)) return { ok: false, value: ERR_ORACLE_MISMATCH };
    this.state.reports.set(key, { ...report, verified: true });
    this.state.events.push({ event: "report-verified", projectId, reportId });
    return { ok: true, value: true };
  }

  finalizeReport(projectId: bigint, reportId: bigint): { ok: boolean; value: boolean } {
    const key = `${projectId}-${reportId}`;
    const report = this.state.reports.get(key);
    if (!report) return { ok: false, value: ERR_PROJECT_NOT_FOUND };
    if (!this.isManager(projectId, this.state.caller)) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (!report.verified) return { ok: false, value: ERR_REPORT_NOT_VERIFIED };
    if (report.finalized) return { ok: false, value: ERR_REPORT_FINALIZED };

    const mkey = `${projectId}-${report["milestone-id"]}`;
    const milestone = this.state.milestones.get(mkey);
    if (!milestone) return { ok: false, value: ERR_MILESTONE_NOT_FOUND };

    const kwhOk = report["kwh-generated"] >= milestone["target-kwh"];
    const houseOk = report["households-powered"] >= milestone["target-households"];
    const co2Ok = report["co2-saved-kg"] >= milestone["target-co2"];
    const allMet = kwhOk && houseOk && co2Ok;

    this.state.reports.set(key, { ...report, finalized: true });
    if (allMet) {
      this.state.milestones.set(mkey, { ...milestone, achieved: true });
      this.state.events.push({ event: "milestone-achieved", projectId, milestoneId: report["milestone-id"] });
    } else {
      this.state.events.push({ event: "milestone-partial", projectId, milestoneId: report["milestone-id"] });
    }
    return { ok: true, value: allMet };
  }

  updateReportMetrics(
    projectId: bigint,
    reportId: bigint,
    kwhGenerated: bigint,
    householdsPowered: bigint,
    co2SavedKg: bigint
  ): { ok: boolean; value: boolean } {
    const key = `${projectId}-${reportId}`;
    const report = this.state.reports.get(key);
    if (!report) return { ok: false, value: false };
    if (!this.isManager(projectId, this.state.caller)) return { ok: false, value: false };
    if (report.verified) return { ok: false, value: false };
    if (kwhGenerated <= 0n || householdsPowered <= 0n || co2SavedKg <= 0n) return { ok: false, value: false };
    this.state.reports.set(key, {
      ...report,
      "kwh-generated": kwhGenerated,
      "households-powered": householdsPowered,
      "co2-saved-kg": co2SavedKg,
    });
    return { ok: true, value: true };
  }

  getTotalReports(): { ok: boolean; value: bigint } {
    return { ok: true, value: this.state.reportNonce };
  }

  getReport(projectId: bigint, reportId: bigint): Report | null {
    return this.state.reports.get(`${projectId}-${reportId}`) || null;
  }

  getMilestone(projectId: bigint, milestoneId: bigint): Milestone | null {
    return this.state.milestones.get(`${projectId}-${milestoneId}`) || null;
  }
}

describe("ReportSubmission", () => {
  let mock: ReportSubmissionMock;

  beforeEach(() => {
    mock = new ReportSubmissionMock();
    mock.reset();
  });

  it("registers project manager", () => {
    mock.setCaller("ST1MANAGER");
    const result = mock.registerProjectManager(1n, "ST2USER");
    expect(result.ok).toBe(true);
    expect(mock.state.managers.get(1n)).toContain("ST2USER");
  });

  it("defines milestone successfully", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    const result = mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    expect(result.ok).toBe(true);
    const milestone = mock.getMilestone(1n, 0n);
    expect(milestone?.["target-kwh"]).toBe(1000n);
  });

  it("submits report with valid data", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    const result = mock.submitReport(
      1n,
      0n,
      "Q1 Report",
      "Solar installation in Kenya",
      dataHash,
      oracleHash,
      0n,
      1200n,
      60n,
      250n
    );
    expect(result.ok).toBe(true);
    expect(mock.state.reportNonce).toBe(1n);
    expect(mock.state.events[0].event).toBe("report-submitted");
  });

  it("rejects duplicate report", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 1200n, 60n, 250n);
    const result = mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 1200n, 60n, 250n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_REPORT_EXISTS);
  });

  it("verifies report with matching oracle hash", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 1200n, 60n, 250n);
    const result = mock.verifyReportOracle(1n, 0n, oracleHash);
    expect(result.ok).toBe(true);
    expect(mock.getReport(1n, 0n)?.verified).toBe(true);
  });

  it("finalizes report and achieves milestone", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 1200n, 60n, 250n);
    mock.verifyReportOracle(1n, 0n, oracleHash);
    const result = mock.finalizeReport(1n, 0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(mock.getMilestone(1n, 0n)?.achieved).toBe(true);
  });

  it("updates metrics before verification", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 100n, 10n, 20n);
    const result = mock.updateReportMetrics(1n, 0n, 1500n, 70n, 300n);
    expect(result.ok).toBe(true);
    expect(mock.getReport(1n, 0n)?.["kwh-generated"]).toBe(1500n);
  });

  it("rejects update after verification", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 100n, 10n, 20n);
    mock.verifyReportOracle(1n, 0n, oracleHash);
    const result = mock.updateReportMetrics(1n, 0n, 1500n, 70n, 300n);
    expect(result.ok).toBe(false);
  });

  it("returns total reports count", () => {
    mock.setCaller("ST1MANAGER");
    mock.registerProjectManager(1n, "ST1MANAGER");
    mock.defineMilestone(1n, 0n, 1000n, 50n, 200n, 5000n);
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const oracleHash = Buffer.from("b".repeat(64), "hex");
    mock.submitReport(1n, 0n, "Q1", "desc", dataHash, oracleHash, 0n, 1200n, 60n, 250n);
    mock.submitReport(1n, 1n, "Q2", "desc", dataHash, oracleHash, 0n, 1300n, 65n, 260n);
    const result = mock.getTotalReports();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2n);
  });
});