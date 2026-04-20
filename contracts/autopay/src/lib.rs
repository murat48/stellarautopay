#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

/// Payment outcome stored on-chain
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum PaymentStatus {
    Success,
    Failed,
    Skipped,
}

/// Immutable record of a payment attempt
#[contracttype]
#[derive(Clone, Debug)]
pub struct PaymentRecord {
    pub id: u64,
    pub bill_id: u64,
    pub bill_name: String,
    pub recipient: Address,
    pub amount: i128,
    pub asset: String,
    pub tx_hash: String,    // "" when failed/skipped
    pub status: PaymentStatus,
    pub error_msg: String,  // "" when success
    pub executed_at: u64,   // unix timestamp (ledger time)
}

/// Bill status stored on-chain
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum BillStatus {
    Active,
    Paused,
    Completed,
    LowBalance,
    Paid,
}

/// Payment frequency
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Frequency {
    Weekly,
    Biweekly,   // every 2 weeks
    Monthly,    // monthly (same relative day as first payment)
    Quarterly,  // every 3 months
    None,       // one-time
}

/// Bill type
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum BillType {
    Recurring,
    OneTime,
}

/// A single bill/payment instruction
#[contracttype]
#[derive(Clone, Debug)]
pub struct Bill {
    pub id: u64,
    pub name: String,
    pub recipient: Address,
    pub amount: i128,    // in stroops (1 XLM = 10_000_000 stroops)
    pub asset: String,   // "XLM" or "USDC"
    pub bill_type: BillType,
    pub frequency: Frequency,
    /// For monthly/quarterly: specific day of month to pay (1-31).
    /// 0 = not set (use relative scheduling).
    /// If the month has fewer days than day_of_month, the frontend
    /// clamps to the last day (e.g. 31 → 30 in April, 28/29 in Feb).
    pub day_of_month: u32,
    pub next_due: u64,   // unix timestamp
    pub status: BillStatus,
    pub created_at: u64,
}

/// Multisig proposal status
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
}

/// A multisig payment proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub bill_id: u64,
    pub bill_name: String,
    pub proposer: Address,
    pub required_approvers: Vec<Address>,
    pub approvals: Vec<Address>,
    pub rejections: Vec<Address>,
    pub threshold: u32,
    pub status: ProposalStatus,
    pub created_at: u64,
}

/// Reference stored per-approver to find proposals they need to sign
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalRef {
    pub proposer: Address,
    pub proposal_id: u64,
}

/// Per-user storage keys — no global owner, each wallet has its own namespace
#[contracttype]
pub enum DataKey {
    NextId(Address),            // u64 - bill id counter per user
    Bill(Address, u64),         // Bill - per user + bill ID
    BillIds(Address),           // Vec<u64> - list of bill IDs per user
    PaymentNextId(Address),     // u64 - payment record counter per user
    Payment(Address, u64),      // PaymentRecord - per user + payment ID
    PaymentIds(Address),        // Vec<u64> - list of payment record IDs per user
    ProposalNextId(Address),    // u64 - proposal id counter per proposer
    ProposalData(Address, u64), // Proposal - per proposer + proposal ID
    ProposalIds(Address),       // Vec<u64> - list of proposal IDs per proposer
    ApproverProposals(Address), // Vec<ProposalRef> - proposals an address needs to sign
}

#[contract]
pub struct AutopayContract;

#[contractimpl]
impl AutopayContract {
    /// Add a new bill. Any authenticated wallet can call this.
    /// No initialization needed — storage is per-caller.
    pub fn add_bill(
        env: Env,
        caller: Address,
        name: String,
        recipient: Address,
        amount: i128,
        asset: String,
        bill_type: BillType,
        frequency: Frequency,
        day_of_month: u32,
        next_due: u64,
    ) -> Bill {
        caller.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }
        if day_of_month > 31 {
            panic!("day_of_month must be 0-31");
        }

        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextId(caller.clone()))
            .unwrap_or(1u64);

        let now = env.ledger().timestamp();

        let bill = Bill {
            id,
            name,
            recipient,
            amount,
            asset,
            bill_type,
            frequency,
            day_of_month,
            next_due,
            status: BillStatus::Active,
            created_at: now,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Bill(caller.clone(), id), &bill);

        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BillIds(caller.clone()))
            .unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::BillIds(caller.clone()), &ids);
        env.storage()
            .persistent()
            .set(&DataKey::NextId(caller), &(id + 1));

        env.events().publish((symbol_short!("bill_add"),), id);
        bill
    }

    /// Pause or resume a bill
    pub fn pause_bill(env: Env, caller: Address, bill_id: u64) {
        caller.require_auth();

        let mut bill: Bill = env
            .storage()
            .persistent()
            .get(&DataKey::Bill(caller.clone(), bill_id))
            .expect("bill not found");

        bill.status = match bill.status {
            BillStatus::Active | BillStatus::LowBalance => BillStatus::Paused,
            BillStatus::Paused => BillStatus::Active,
            other => other,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Bill(caller, bill_id), &bill);
        env.events().publish((symbol_short!("bill_upd"),), bill_id);
    }

    /// Update bill status (called by session key in auto-pay engine)
    pub fn update_status(env: Env, caller: Address, bill_id: u64, status: BillStatus) {
        caller.require_auth();

        let mut bill: Bill = env
            .storage()
            .persistent()
            .get(&DataKey::Bill(caller.clone(), bill_id))
            .expect("bill not found");

        bill.status = status;
        env.storage()
            .persistent()
            .set(&DataKey::Bill(caller, bill_id), &bill);
    }

    /// Update the next_due date after a successful payment
    pub fn update_next_due(env: Env, caller: Address, bill_id: u64, new_next_due: u64) {
        caller.require_auth();

        let mut bill: Bill = env
            .storage()
            .persistent()
            .get(&DataKey::Bill(caller.clone(), bill_id))
            .expect("bill not found");

        bill.next_due = new_next_due;
        env.storage()
            .persistent()
            .set(&DataKey::Bill(caller, bill_id), &bill);
    }

    /// Mark a one-time bill as completed
    pub fn complete_bill(env: Env, caller: Address, bill_id: u64) {
        caller.require_auth();

        let mut bill: Bill = env
            .storage()
            .persistent()
            .get(&DataKey::Bill(caller.clone(), bill_id))
            .expect("bill not found");

        bill.status = BillStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::Bill(caller, bill_id), &bill);
        env.events().publish((symbol_short!("bill_cmp"),), bill_id);
    }

    /// Mark a bill as paid (payment was successfully sent on-chain).
    /// Different from complete_bill: Paid means money was transferred.
    pub fn mark_paid(env: Env, caller: Address, bill_id: u64) {
        caller.require_auth();

        let mut bill: Bill = env
            .storage()
            .persistent()
            .get(&DataKey::Bill(caller.clone(), bill_id))
            .expect("bill not found");

        bill.status = BillStatus::Paid;
        env.storage()
            .persistent()
            .set(&DataKey::Bill(caller, bill_id), &bill);
        env.events().publish((symbol_short!("bill_pd"),), bill_id);
    }

    /// Delete a bill
    pub fn delete_bill(env: Env, caller: Address, bill_id: u64) {
        caller.require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::Bill(caller.clone(), bill_id));

        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BillIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut new_ids: Vec<u64> = Vec::new(&env);
        for id in ids.iter() {
            if id != bill_id {
                new_ids.push_back(id);
            }
        }
        env.storage()
            .persistent()
            .set(&DataKey::BillIds(caller), &new_ids);
        env.events().publish((symbol_short!("bill_del"),), bill_id);
    }

    /// Get a single bill by caller + ID
    pub fn get_bill(env: Env, caller: Address, bill_id: u64) -> Bill {
        env.storage()
            .persistent()
            .get(&DataKey::Bill(caller, bill_id))
            .expect("bill not found")
    }

    /// Get all bills for a given wallet address
    pub fn get_all_bills(env: Env, caller: Address) -> Vec<Bill> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BillIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut bills: Vec<Bill> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(bill) = env
                .storage()
                .persistent()
                .get(&DataKey::Bill(caller.clone(), id))
            {
                bills.push_back(bill);
            }
        }
        bills
    }

    /// Get only active bills for a given wallet (for payment engine polling)
    pub fn get_active_bills(env: Env, caller: Address) -> Vec<Bill> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BillIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut active: Vec<Bill> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(bill) = env
                .storage()
                .persistent()
                .get::<DataKey, Bill>(&DataKey::Bill(caller.clone(), id))
            {
                if bill.status == BillStatus::Active || bill.status == BillStatus::LowBalance {
                    active.push_back(bill);
                }
            }
        }
        active
    }

    /// Record a payment attempt (success / failed / skipped).
    /// Called by the auto-pay engine after each payment attempt.
    pub fn record_payment(
        env: Env,
        caller: Address,
        bill_id: u64,
        bill_name: String,
        recipient: Address,
        amount: i128,
        asset: String,
        tx_hash: String,
        status: PaymentStatus,
        error_msg: String,
    ) -> PaymentRecord {
        caller.require_auth();

        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentNextId(caller.clone()))
            .unwrap_or(1u64);

        let record = PaymentRecord {
            id,
            bill_id,
            bill_name,
            recipient,
            amount,
            asset,
            tx_hash,
            status,
            error_msg,
            executed_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Payment(caller.clone(), id), &record);

        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentIds(caller.clone()))
            .unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::PaymentIds(caller.clone()), &ids);
        env.storage()
            .persistent()
            .set(&DataKey::PaymentNextId(caller), &(id + 1));

        env.events().publish((symbol_short!("pay_rec"),), id);
        record
    }

    /// Get all payment records for a wallet (newest last).
    pub fn get_payment_history(env: Env, caller: Address) -> Vec<PaymentRecord> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::PaymentIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut records: Vec<PaymentRecord> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(rec) = env
                .storage()
                .persistent()
                .get(&DataKey::Payment(caller.clone(), id))
            {
                records.push_back(rec);
            }
        }
        records
    }

    /// Create a multisig payment proposal for a bill.
    /// required_approvers must all sign; threshold sets minimum approvals needed.
    pub fn propose_payment(
        env: Env,
        caller: Address,
        bill_id: u64,
        required_approvers: Vec<Address>,
        threshold: u32,
    ) -> Proposal {
        caller.require_auth();

        if threshold == 0 {
            panic!("threshold must be at least 1");
        }
        if threshold > required_approvers.len() {
            panic!("threshold cannot exceed number of approvers");
        }

        let bill: Bill = env
            .storage()
            .persistent()
            .get(&DataKey::Bill(caller.clone(), bill_id))
            .expect("bill not found");

        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalNextId(caller.clone()))
            .unwrap_or(1u64);

        let proposal = Proposal {
            id,
            bill_id,
            bill_name: bill.name,
            proposer: caller.clone(),
            required_approvers,
            approvals: Vec::new(&env),
            rejections: Vec::new(&env),
            threshold,
            status: ProposalStatus::Pending,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::ProposalData(caller.clone(), id), &proposal);

        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalIds(caller.clone()))
            .unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&DataKey::ProposalIds(caller.clone()), &ids);
        env.storage()
            .persistent()
            .set(&DataKey::ProposalNextId(caller.clone()), &(id + 1));

        // Index this proposal under each required approver so they can
        // discover it without knowing the proposer's address.
        for approver in proposal.required_approvers.iter() {
            let mut refs: Vec<ProposalRef> = env
                .storage()
                .persistent()
                .get(&DataKey::ApproverProposals(approver.clone()))
                .unwrap_or(Vec::new(&env));
            refs.push_back(ProposalRef {
                proposer: caller.clone(),
                proposal_id: id,
            });
            env.storage()
                .persistent()
                .set(&DataKey::ApproverProposals(approver), &refs);
        }

        env.events().publish((symbol_short!("prop_new"),), id);
        proposal
    }

    /// Approve a multisig proposal. Caller must be in required_approvers.
    pub fn approve_proposal(env: Env, approver: Address, proposer: Address, proposal_id: u64) {
        approver.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalData(proposer.clone(), proposal_id))
            .expect("proposal not found");

        if proposal.status != ProposalStatus::Pending {
            panic!("proposal is not pending");
        }

        let mut authorized = false;
        for a in proposal.required_approvers.iter() {
            if a == approver {
                authorized = true;
                break;
            }
        }
        if !authorized {
            panic!("not an authorized approver");
        }

        for a in proposal.approvals.iter() {
            if a == approver {
                panic!("already approved");
            }
        }
        for r in proposal.rejections.iter() {
            if r == approver {
                panic!("already rejected");
            }
        }

        proposal.approvals.push_back(approver);

        env.storage()
            .persistent()
            .set(&DataKey::ProposalData(proposer, proposal_id), &proposal);
        env.events().publish((symbol_short!("prop_apv"),), proposal_id);
    }

    /// Reject a multisig proposal. Caller must be in required_approvers.
    pub fn reject_proposal(env: Env, rejector: Address, proposer: Address, proposal_id: u64) {
        rejector.require_auth();

        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalData(proposer.clone(), proposal_id))
            .expect("proposal not found");

        if proposal.status != ProposalStatus::Pending {
            panic!("proposal is not pending");
        }

        let mut authorized = false;
        for a in proposal.required_approvers.iter() {
            if a == rejector {
                authorized = true;
                break;
            }
        }
        if !authorized {
            panic!("not an authorized approver");
        }

        for a in proposal.approvals.iter() {
            if a == rejector {
                panic!("already approved");
            }
        }
        for r in proposal.rejections.iter() {
            if r == rejector {
                panic!("already rejected");
            }
        }

        proposal.rejections.push_back(rejector);

        // Mark rejected when threshold can no longer be met
        let max_possible = proposal
            .required_approvers
            .len()
            .saturating_sub(proposal.rejections.len());
        if max_possible < proposal.threshold {
            proposal.status = ProposalStatus::Rejected;
        }

        env.storage()
            .persistent()
            .set(&DataKey::ProposalData(proposer, proposal_id), &proposal);
        env.events().publish((symbol_short!("prop_rej"),), proposal_id);
    }

    /// Execute a proposal once the approval threshold is met.
    /// Anyone can trigger execution once the threshold is met.
    /// Security is enforced by the on-chain approval count — no additional
    /// caller auth is required (the approvers already signed on-chain).
    pub fn execute_proposal(env: Env, proposer: Address, proposal_id: u64) {
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalData(proposer.clone(), proposal_id))
            .expect("proposal not found");

        if proposal.status != ProposalStatus::Pending {
            panic!("proposal is not pending");
        }
        if proposal.approvals.len() < proposal.threshold {
            panic!("approval threshold not met");
        }

        proposal.status = ProposalStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::ProposalData(proposer, proposal_id), &proposal);
        env.events().publish((symbol_short!("prop_exe"),), proposal_id);
    }

    /// Get all proposals created by a wallet.
    pub fn get_proposals(env: Env, caller: Address) -> Vec<Proposal> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut proposals: Vec<Proposal> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(proposal) = env
                .storage()
                .persistent()
                .get(&DataKey::ProposalData(caller.clone(), id))
            {
                proposals.push_back(proposal);
            }
        }
        proposals
    }

    /// Get only pending proposals created by a wallet.
    pub fn get_pending_proposals(env: Env, caller: Address) -> Vec<Proposal> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalIds(caller.clone()))
            .unwrap_or(Vec::new(&env));

        let mut pending: Vec<Proposal> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(proposal) = env
                .storage()
                .persistent()
                .get::<DataKey, Proposal>(&DataKey::ProposalData(caller.clone(), id))
            {
                if proposal.status == ProposalStatus::Pending {
                    pending.push_back(proposal);
                }
            }
        }
        pending
    }

    /// Get pending proposals that require this wallet's approval
    /// (i.e., this address is listed as a required approver).
    pub fn get_proposals_as_approver(env: Env, approver: Address) -> Vec<Proposal> {
        let refs: Vec<ProposalRef> = env
            .storage()
            .persistent()
            .get(&DataKey::ApproverProposals(approver.clone()))
            .unwrap_or(Vec::new(&env));

        let mut pending: Vec<Proposal> = Vec::new(&env);
        for pref in refs.iter() {
            if let Some(proposal) = env
                .storage()
                .persistent()
                .get::<DataKey, Proposal>(&DataKey::ProposalData(
                    pref.proposer.clone(),
                    pref.proposal_id,
                ))
            {
                if proposal.status == ProposalStatus::Pending {
                    pending.push_back(proposal);
                }
            }
        }
        pending
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_full_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AutopayContract, ());
        let client = AutopayContractClient::new(&env, &contract_id);

        // No initialization needed — per-user storage
        let user = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Add a recurring bill — works immediately for any wallet
        let bill = client.add_bill(
            &user,
            &String::from_str(&env, "Server"),
            &recipient,
            &100_0000000, // 100 XLM in stroops
            &String::from_str(&env, "XLM"),
            &BillType::Recurring,
            &Frequency::Monthly,
            &15, // pay on the 15th of every month
            &1700000000,
        );
        assert_eq!(bill.id, 1);
        assert_eq!(bill.day_of_month, 15);
        assert_eq!(bill.status, BillStatus::Active);

        // Add a biweekly bill
        let bill2 = client.add_bill(
            &user,
            &String::from_str(&env, "Salary"),
            &recipient,
            &500_0000000,
            &String::from_str(&env, "XLM"),
            &BillType::Recurring,
            &Frequency::Biweekly,
            &0,
            &1700000000,
        );
        assert_eq!(bill2.id, 2);

        // Add a one-time bill
        let bill3 = client.add_bill(
            &user,
            &String::from_str(&env, "Invoice"),
            &recipient,
            &50_0000000,
            &String::from_str(&env, "XLM"),
            &BillType::OneTime,
            &Frequency::None,
            &0,
            &1700000000,
        );
        assert_eq!(bill3.id, 3);

        // Get all bills for this user
        let all = client.get_all_bills(&user);
        assert_eq!(all.len(), 3);

        // Pause
        client.pause_bill(&user, &1);
        let paused = client.get_bill(&user, &1);
        assert_eq!(paused.status, BillStatus::Paused);

        // Resume
        client.pause_bill(&user, &1);
        let resumed = client.get_bill(&user, &1);
        assert_eq!(resumed.status, BillStatus::Active);

        // Complete one-time
        client.complete_bill(&user, &3);
        let completed = client.get_bill(&user, &3);
        assert_eq!(completed.status, BillStatus::Completed);

        // Delete
        client.delete_bill(&user, &1);
        let remaining = client.get_all_bills(&user);
        assert_eq!(remaining.len(), 2);

        // Get active — bill3 is completed, bill1 deleted, bill2 still active
        let active = client.get_active_bills(&user);
        assert_eq!(active.len(), 1);

        // Different user has empty bills (namespaces are isolated)
        let other_user = Address::generate(&env);
        let other_bills = client.get_all_bills(&other_user);
        assert_eq!(other_bills.len(), 0);

        // Record payment history
        let rec = client.record_payment(
            &user,
            &2,
            &String::from_str(&env, "Salary"),
            &recipient,
            &500_0000000,
            &String::from_str(&env, "XLM"),
            &String::from_str(&env, "abc123txhash"),
            &PaymentStatus::Success,
            &String::from_str(&env, ""),
        );
        assert_eq!(rec.id, 1);
        assert_eq!(rec.bill_id, 2);
        assert_eq!(rec.status, PaymentStatus::Success);

        // Record a failed payment
        client.record_payment(
            &user,
            &2,
            &String::from_str(&env, "Salary"),
            &recipient,
            &500_0000000,
            &String::from_str(&env, "XLM"),
            &String::from_str(&env, ""),
            &PaymentStatus::Failed,
            &String::from_str(&env, "op_underfunded"),
        );

        let history = client.get_payment_history(&user);
        assert_eq!(history.len(), 2);
        assert_eq!(history.get(1).unwrap().status, PaymentStatus::Failed);

        // Other user has empty history
        let other_history = client.get_payment_history(&other_user);
        assert_eq!(other_history.len(), 0);
    }

    #[test]
    fn test_multisig_approve_and_execute() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AutopayContract, ());
        let client = AutopayContractClient::new(&env, &contract_id);

        let proposer  = Address::generate(&env);
        let approver1 = Address::generate(&env);
        let approver2 = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Proposer must own a bill
        let bill = client.add_bill(
            &proposer,
            &String::from_str(&env, "Office Rent"),
            &recipient,
            &200_0000000,
            &String::from_str(&env, "XLM"),
            &BillType::Recurring,
            &Frequency::Monthly,
            &1,
            &1700000000,
        );

        // Create a 2-of-2 proposal
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(approver1.clone());
        approvers.push_back(approver2.clone());
        let proposal = client.propose_payment(&proposer, &bill.id, &approvers, &2);
        assert_eq!(proposal.id, 1);
        assert_eq!(proposal.bill_id, bill.id);
        assert_eq!(proposal.threshold, 2);
        assert_eq!(proposal.status, ProposalStatus::Pending);

        // Pending proposals listed
        let pending = client.get_pending_proposals(&proposer);
        assert_eq!(pending.len(), 1);

        // First approval — threshold not yet met
        client.approve_proposal(&approver1, &proposer, &proposal.id);
        let still_pending = client.get_pending_proposals(&proposer);
        assert_eq!(still_pending.len(), 1);

        // Second approval — threshold met
        client.approve_proposal(&approver2, &proposer, &proposal.id);

        // Execute
        client.execute_proposal(&proposer, &proposal.id);

        // No longer pending
        let after_exec = client.get_pending_proposals(&proposer);
        assert_eq!(after_exec.len(), 0);

        // Still shows up in get_proposals as Executed
        let all = client.get_proposals(&proposer);
        assert_eq!(all.len(), 1);
        assert_eq!(all.get(0).unwrap().status, ProposalStatus::Executed);
    }

    #[test]
    fn test_multisig_rejection() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AutopayContract, ());
        let client = AutopayContractClient::new(&env, &contract_id);

        let proposer  = Address::generate(&env);
        let approver1 = Address::generate(&env);
        let approver2 = Address::generate(&env);
        let recipient = Address::generate(&env);

        let bill = client.add_bill(
            &proposer,
            &String::from_str(&env, "Software License"),
            &recipient,
            &10_0000000,
            &String::from_str(&env, "XLM"),
            &BillType::OneTime,
            &Frequency::None,
            &0,
            &1700000000,
        );

        // 1-of-2 threshold — only one approval needed
        let mut approvers: Vec<Address> = Vec::new(&env);
        approvers.push_back(approver1.clone());
        approvers.push_back(approver2.clone());
        let proposal = client.propose_payment(&proposer, &bill.id, &approvers, &1);
        assert_eq!(proposal.status, ProposalStatus::Pending);

        // Both reject — threshold can never be met
        client.reject_proposal(&approver1, &proposer, &proposal.id);
        client.reject_proposal(&approver2, &proposer, &proposal.id);

        let all = client.get_proposals(&proposer);
        assert_eq!(all.get(0).unwrap().status, ProposalStatus::Rejected);

        // No pending proposals remain
        let pending = client.get_pending_proposals(&proposer);
        assert_eq!(pending.len(), 0);
    }
}
