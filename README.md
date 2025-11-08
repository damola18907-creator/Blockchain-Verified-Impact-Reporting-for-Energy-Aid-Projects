# 🔋 Blockchain-Verified Impact Reporting for Energy Aid Projects

Welcome to a transparent and trustworthy system for tracking the real-world impact of energy aid initiatives! This Web3 project uses the Stacks blockchain and Clarity smart contracts to provide immutable, verifiable reporting on energy aid projects (e.g., solar panel installations in underserved communities). By ensuring donors can see proven results like energy generated or households powered, it builds trust and attracts more funding from philanthropists, NGOs, and corporations.

This solves the real-world problem of opacity in aid reporting, where traditional systems often lack verifiable data, leading to donor skepticism and reduced contributions. With blockchain, every impact metric is timestamped, auditable, and tamper-proof, encouraging greater investment in sustainable energy solutions.

## ✨ Features
🔍 Immutable impact reports with verifiable metrics (e.g., kWh generated, CO2 saved)  
💰 Transparent donation tracking and milestone-based fund releases  
📈 Donor dashboards for real-time project progress  
✅ Third-party verification to prevent fraud  
🏆 Reward tokens for verified project milestones to incentivize aid organizations  
🌍 Global accessibility for energy aid in developing regions  
🚫 Anti-duplication checks for reports and projects  

## 🛠 How It Works
This project leverages 8 interconnected Clarity smart contracts to manage the entire lifecycle of energy aid projects. Creators (aid organizations) register projects, submit verifiable impact data via oracles, and release reports. Donors contribute funds, track progress, and verify outcomes. The system uses STX (Stacks' native token) for donations and a custom impact token for rewards.

**For Aid Organizations (Project Managers):**
- Register your energy aid project with details like location, goals, and expected impact.
- Submit periodic impact reports with data from trusted oracles (e.g., IoT devices measuring energy output).
- Achieve milestones to unlock funds and earn reward tokens.
- Use the governance contract to propose system improvements.

**For Donors:**
- Browse and fund registered projects.
- View verified impact reports and metrics in real-time.
- Verify ownership and authenticity of reports to ensure your donations make a difference.

**For Verifiers/Auditors:**
- Use the verification contract to check report hashes against oracle data.
- Audit fund usage and impact claims for transparency.

### 📑 Smart Contracts Overview
All contracts are written in Clarity for the Stacks blockchain, ensuring security and clarity (pun intended). They interact via public functions and traits for modularity.

1. **ProjectRegistry.clar**: Registers new energy aid projects with unique IDs, descriptions, locations, and target metrics (e.g., "Install 100 solar panels in rural Kenya"). Prevents duplicates and stores project metadata.

2. **DonationHandler.clar**: Manages STX donations to specific projects. Tracks donor contributions, emits events for receipts, and holds funds in escrow until milestones are met.

3. **ImpactOracle.clar**: Interfaces with external oracles to input real-world data (e.g., energy production from sensors). Validates and timestamps metrics like kWh generated or households electrified.

4. **ReportSubmission.clar**: Allows project managers to submit impact reports with hashes of data (e.g., SHA-256 of a PDF report + metrics). Links to oracle data for immutability.

5. **MilestoneVerifier.clar**: Verifies if project milestones are achieved based on submitted reports and oracle inputs. Triggers fund releases and token minting upon success.

6. **ImpactToken.clar**: A fungible token (SIP-010 compliant) rewarded to projects for verified impacts. Donors can stake tokens for governance or redeem for perks.

7. **AuditTrail.clar**: Logs all actions (registrations, donations, reports) in an immutable audit log. Provides query functions for transparency and dispute resolution.

8. **Governance.clar**: Enables token holders to vote on system parameters, like reward rates or oracle approvals. Uses quadratic voting to prevent whale dominance.

### 🚀 Getting Started
- Deploy the contracts on Stacks testnet using the Clarity CLI.
- Interact via Hiro Wallet or Stacks Explorer.
- Example flow: Call `register-project` in ProjectRegistry, fund via DonationHandler, submit data to ImpactOracle, and verify with MilestoneVerifier.

This setup ensures energy aid becomes more accountable, scalable, and donor-friendly—ultimately powering more sustainable futures!