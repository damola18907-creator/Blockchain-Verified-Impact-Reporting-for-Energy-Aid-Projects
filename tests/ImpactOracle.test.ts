// ImpactOracle.test.ts

import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 300;
const ERR_ORACLE_NOT_REGISTERED = 301;
const ERR_DATA_EXISTS = 302;
const ERR_INVALID_HASH = 303;
const ERR_PROJECT_NOT_FOUND = 304;
const ERR_ORACLE_REVOKED = 307;

interface OracleInfo {
  name: string;
  active: boolean;
  dataCount: bigint;
  lastSubmission: bigint;
}

interface OracleData {
  oracle: string;
  "data-hash": Buffer;
  kwh: bigint;
  households: bigint;
  "co2-kg": bigint;
  timestamp: bigint;
  "signature-valid": boolean;
}

interface MockState {
  contractOwner: string;
  oracleNonce: bigint;
  registeredOracles: Map<string, OracleInfo>;
  oracleData: Map<string, OracleData>;
  projectOracleAssignments: Map<string, boolean>;
  blockHeight: bigint;
  caller: string;
  events: any[];
}

class ImpactOracleMock {
  state: MockState = {
    contractOwner: "ST1OWNER",
    oracleNonce: 0n,
    registeredOracles: new Map(),
    oracleData: new Map(),
    projectOracleAssignments: new Map(),
    blockHeight: 100n,
    caller: "ST1OWNER",
    events: [],
  };

  reset() {
    this.state = {
      contractOwner: "ST1OWNER",
      oracleNonce: 0n,
      registeredOracles: new Map(),
      oracleData: new Map(),
      projectOracleAssignments: new Map(),
      blockHeight: 100n,
      caller: "ST1OWNER",
      events: [],
    };
  }

  setCaller(caller: string) {
    this.state.caller = caller;
  }

  setBlockHeight(height: bigint) {
    this.state.blockHeight = height;
  }

  registerOracle(name: string): { ok: boolean; value: boolean } {
    if (this.state.caller !== this.state.contractOwner)
      return { ok: false, value: false };
    if (this.state.registeredOracles.has(this.state.caller))
      return { ok: false, value: false };
    this.state.registeredOracles.set(this.state.caller, {
      name,
      active: true,
      dataCount: 0n,
      lastSubmission: 0n,
    });
    this.state.events.push({
      event: "oracle-registered",
      oracle: this.state.caller,
      name,
    });
    return { ok: true, value: true };
  }

  revokeOracle(oracle: string): { ok: boolean; value: boolean } {
    if (this.state.caller !== this.state.contractOwner)
      return { ok: false, value: false };
    const info = this.state.registeredOracles.get(oracle);
    if (!info) return { ok: false, value: false };
    this.state.registeredOracles.set(oracle, { ...info, active: false });
    this.state.events.push({ event: "oracle-revoked", oracle });
    return { ok: true, value: true };
  }

  assignOracleToProject(
    projectId: bigint,
    oracle: string
  ): { ok: boolean; value: boolean } {
    if (this.state.caller !== this.state.contractOwner)
      return { ok: false, value: false };
    const info = this.state.registeredOracles.get(oracle);
    if (!info || !info.active) return { ok: false, value: false };
    const key = `${projectId}-${oracle}`;
    this.state.projectOracleAssignments.set(key, true);
    this.state.events.push({ event: "oracle-assigned", projectId, oracle });
    return { ok: true, value: true };
  }

  submitOracleData(
    projectId: bigint,
    submissionId: bigint,
    dataHash: Buffer,
    kwh: bigint,
    households: bigint,
    co2Kg: bigint
  ): { ok: boolean; value: boolean } {
    const info = this.state.registeredOracles.get(this.state.caller);
    if (!info || !info.active) return { ok: false, value: ERR_ORACLE_REVOKED };
    const assignKey = `${projectId}-${this.state.caller}`;
    if (!this.state.projectOracleAssignments.has(assignKey))
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    const dataKey = `${projectId}-${submissionId}`;
    if (this.state.oracleData.has(dataKey))
      return { ok: false, value: ERR_DATA_EXISTS };
    if (dataHash.length !== 32) return { ok: false, value: ERR_INVALID_HASH };
    if (kwh <= 0n || households <= 0n || co2Kg <= 0n)
      return { ok: false, value: 0 };
    if (this.state.blockHeight < this.state.blockHeight - 100n)
      return { ok: false, value: 0 };

    this.state.oracleData.set(dataKey, {
      oracle: this.state.caller,
      "data-hash": dataHash,
      kwh,
      households,
      "co2-kg": co2Kg,
      timestamp: this.state.blockHeight,
      "signature-valid": true,
    });
    this.state.registeredOracles.set(this.state.caller, {
      ...info,
      dataCount: info.dataCount + 1n,
      lastSubmission: this.state.blockHeight,
    });
    this.state.oracleNonce += 1n;
    this.state.events.push({
      event: "oracle-data-submitted",
      projectId,
      submissionId,
      oracle: this.state.caller,
    });
    return { ok: true, value: true };
  }

  updateOracleData(
    projectId: bigint,
    submissionId: bigint,
    kwh: bigint,
    households: bigint,
    co2Kg: bigint
  ): { ok: boolean; value: boolean } {
    const dataKey = `${projectId}-${submissionId}`;
    const data = this.state.oracleData.get(dataKey);
    if (!data || data.oracle !== this.state.caller)
      return { ok: false, value: false };
    if (kwh <= 0n || households <= 0n || co2Kg <= 0n)
      return { ok: false, value: false };
    this.state.oracleData.set(dataKey, {
      ...data,
      kwh,
      households,
      "co2-kg": co2Kg,
    });
    this.state.events.push({
      event: "oracle-data-updated",
      projectId,
      submissionId,
    });
    return { ok: true, value: true };
  }

  getOracleHashForReport(
    projectId: bigint,
    submissionId: bigint
  ): { ok: boolean; value: Buffer } | { err: number } {
    const data = this.state.oracleData.get(`${projectId}-${submissionId}`);
    return data
      ? { ok: true, value: data["data-hash"] }
      : { err: ERR_PROJECT_NOT_FOUND };
  }

  getOracle(oracle: string): OracleInfo | null {
    return this.state.registeredOracles.get(oracle) || null;
  }

  getOracleData(projectId: bigint, submissionId: bigint): OracleData | null {
    return this.state.oracleData.get(`${projectId}-${submissionId}`) || null;
  }

  getTotalSubmissions(): { ok: boolean; value: bigint } {
    return { ok: true, value: this.state.oracleNonce };
  }
}

describe("ImpactOracle", () => {
  let mock: ImpactOracleMock;

  beforeEach(() => {
    mock = new ImpactOracleMock();
    mock.reset();
  });

  it("registers oracle successfully", () => {
    const result = mock.registerOracle("SolarSense Inc");
    expect(result.ok).toBe(true);
    const oracle = mock.getOracle("ST1OWNER");
    expect(oracle?.name).toBe("SolarSense Inc");
    expect(oracle?.active).toBe(true);
  });

  it("assigns oracle to project", () => {
    mock.registerOracle("GridWatch");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.setCaller("ST1OWNER");
    const dataHash = Buffer.from("a".repeat(64), "hex");
    const result = mock.submitOracleData(1n, 0n, dataHash, 1500n, 75n, 300n);
    expect(result.ok).toBe(true);
  });

  it("submits oracle data with valid hash and metrics", () => {
    mock.registerOracle("EcoMeter");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.setCaller("ST1OWNER");
    const dataHash = Buffer.from("b".repeat(64), "hex");
    const result = mock.submitOracleData(1n, 0n, dataHash, 1200n, 60n, 240n);
    expect(result.ok).toBe(true);
    const data = mock.getOracleData(1n, 0n);
    expect(data?.kwh).toBe(1200n);
    expect(mock.state.oracleNonce).toBe(1n);
  });

  it("rejects duplicate submission", () => {
    mock.registerOracle("EcoMeter");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.setCaller("ST1OWNER");
    const dataHash = Buffer.from("c".repeat(64), "hex");
    mock.submitOracleData(1n, 0n, dataHash, 1000n, 50n, 200n);
    const result = mock.submitOracleData(1n, 0n, dataHash, 1100n, 55n, 220n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DATA_EXISTS);
  });

  it("revokes oracle and blocks submission", () => {
    mock.registerOracle("BadOracle");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.revokeOracle("ST1OWNER");
    mock.setCaller("ST1OWNER");
    const dataHash = Buffer.from("d".repeat(64), "hex");
    const result = mock.submitOracleData(1n, 0n, dataHash, 1000n, 50n, 200n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ORACLE_REVOKED);
  });

  it("updates existing oracle data", () => {
    mock.registerOracle("Updater");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.setCaller("ST1OWNER");
    const dataHash = Buffer.from("e".repeat(64), "hex");
    mock.submitOracleData(1n, 0n, dataHash, 1000n, 50n, 200n);
    const result = mock.updateOracleData(1n, 0n, 1300n, 65n, 260n);
    expect(result.ok).toBe(true);
    const data = mock.getOracleData(1n, 0n);
    expect(data?.kwh).toBe(1300n);
  });

  it("returns correct oracle hash for report", () => {
    mock.registerOracle("HashProvider");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.setCaller("ST1OWNER");
    const dataHash = Buffer.from("f".repeat(64), "hex");
    mock.submitOracleData(1n, 0n, dataHash, 1000n, 50n, 200n);
    const result = mock.getOracleHashForReport(1n, 0n);
    expect(result.ok).toBe(true);
    expect(Buffer.from((result as any).value)).toEqual(dataHash);
  });

  it("tracks total submissions", () => {
    mock.registerOracle("MultiSub");
    mock.assignOracleToProject(1n, "ST1OWNER");
    mock.setCaller("ST1OWNER");
    const hash = Buffer.from("0".repeat(64), "hex");
    mock.submitOracleData(1n, 0n, hash, 1000n, 50n, 200n);
    mock.submitOracleData(1n, 1n, hash, 1100n, 55n, 220n);
    const total = mock.getTotalSubmissions();
    expect(total.value).toBe(2n);
  });
});
