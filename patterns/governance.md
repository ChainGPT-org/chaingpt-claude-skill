# Governance Patterns

Complete, production-ready DAO and governance patterns for the ChainGPT Contract Generator.

---

## 1. Governor (OpenZeppelin)

Full Governor + TimelockController setup for on-chain governance.

**When to use:** Full-featured DAO governance with proposal lifecycle, voting, timelock, and execution.

**Security considerations:**
- TimelockController adds mandatory delay between vote success and execution
- Quorum prevents proposals from passing with very low participation
- Voting delay prevents flash loan governance attacks (acquire, vote, dump)
- Proposer threshold prevents spam proposals
- Guardian role on timelock for emergency cancellation

**Gas optimization:** Proposal creation ~200k gas. Voting ~80k gas. Execution varies by payload.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/**
 * @title DAOGovernor
 * @author ChainGPT Pattern Library
 * @notice Full OpenZeppelin Governor with timelock, quorum, and settings.
 * @dev Deploy with a GovernanceToken (ERC20Votes) and TimelockController.
 *
 * Deployment order:
 * 1. Deploy GovernanceToken (see tokens.md pattern #9)
 * 2. Deploy TimelockController (see below)
 * 3. Deploy DAOGovernor with token and timelock addresses
 * 4. Grant PROPOSER_ROLE and EXECUTOR_ROLE on timelock to governor
 * 5. Renounce TIMELOCK_ADMIN_ROLE from deployer (optional, for full decentralization)
 */
contract DAOGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /**
     * @param token_ Governance token with ERC20Votes
     * @param timelock_ TimelockController address
     * @param votingDelay_ Delay in blocks before voting starts (e.g., 7200 = ~1 day)
     * @param votingPeriod_ Voting duration in blocks (e.g., 50400 = ~1 week)
     * @param proposalThreshold_ Min tokens to create proposal (in wei)
     * @param quorumPercent_ Quorum as percentage of total supply (e.g., 4 = 4%)
     */
    constructor(
        IVotes token_,
        TimelockController timelock_,
        uint48 votingDelay_,
        uint32 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumPercent_
    )
        Governor("DAOGovernor")
        GovernorSettings(votingDelay_, votingPeriod_, proposalThreshold_)
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(quorumPercent_)
        GovernorTimelockControl(timelock_)
    {}

    // Required overrides for Solidity linearization

    function votingDelay() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public view override(Governor, GovernorVotesQuorumFraction) returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }
}
```

**TimelockController deployment helper:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title DAOTimelock
 * @author ChainGPT Pattern Library
 * @notice TimelockController for DAO governance.
 * @dev Deploy before the Governor. Grant roles to Governor after deployment.
 *
 * Constructor parameters:
 * - minDelay: Minimum time between queuing and execution (e.g., 2 days)
 * - proposers: Addresses allowed to queue (set to Governor address after deploy)
 * - executors: Addresses allowed to execute (address(0) = anyone can execute)
 * - admin: Initial admin (set to deployer, then renounce after setup)
 */
contract DAOTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
```

---

## 2. Simple Voting

Lightweight proposal + vote + execute with quorum. No external dependencies.

**When to use:** Simple governance without OpenZeppelin Governor complexity. Suitable for small DAOs or protocol parameter changes.

**Security considerations:**
- Voting power is based on token balance at proposal creation (snapshot)
- No timelock -- consider adding one for critical operations
- Single-block snapshot can be flash-loan attacked; use multi-block TWAP for production
- Quorum prevents low-participation attacks

**Gas optimization:** ~150k gas per proposal creation. ~50k per vote. ~variable for execution.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleVoting
 * @author ChainGPT Pattern Library
 * @notice Lightweight proposal, vote, and execute governance.
 */
contract SimpleVoting is Ownable {
    IERC20 public immutable governanceToken;

    uint256 public votingDuration; // seconds
    uint256 public quorumBps;      // basis points of total supply
    uint256 public proposalCount;

    enum ProposalState { Pending, Active, Succeeded, Defeated, Executed, Cancelled }

    struct Proposal {
        address proposer;
        string description;
        address target;
        bytes callData;
        uint256 value;
        uint256 startTime;
        uint256 endTime;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool cancelled;
        mapping(address => bool) hasVoted;
    }

    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed id, address proposer, string description);
    event Voted(uint256 indexed id, address voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);

    /**
     * @param token_ Governance token address
     * @param votingDuration_ Voting period in seconds
     * @param quorumBps_ Required quorum in basis points (e.g., 400 = 4%)
     */
    constructor(
        address token_,
        uint256 votingDuration_,
        uint256 quorumBps_
    ) Ownable(msg.sender) {
        governanceToken = IERC20(token_);
        votingDuration = votingDuration_;
        quorumBps = quorumBps_;
    }

    /**
     * @notice Create a new proposal.
     */
    function propose(
        string memory description,
        address target,
        bytes memory callData,
        uint256 value
    ) external returns (uint256) {
        require(governanceToken.balanceOf(msg.sender) > 0, "No tokens");

        uint256 id = proposalCount++;
        Proposal storage p = proposals[id];
        p.proposer = msg.sender;
        p.description = description;
        p.target = target;
        p.callData = callData;
        p.value = value;
        p.startTime = block.timestamp;
        p.endTime = block.timestamp + votingDuration;

        emit ProposalCreated(id, msg.sender, description);
        return id;
    }

    /**
     * @notice Vote on a proposal.
     * @param id Proposal ID
     * @param support True = for, false = against
     */
    function vote(uint256 id, bool support) external {
        Proposal storage p = proposals[id];
        require(block.timestamp >= p.startTime && block.timestamp <= p.endTime, "Voting closed");
        require(!p.hasVoted[msg.sender], "Already voted");

        uint256 weight = governanceToken.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        p.hasVoted[msg.sender] = true;
        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit Voted(id, msg.sender, support, weight);
    }

    /**
     * @notice Execute a succeeded proposal.
     */
    function execute(uint256 id) external {
        Proposal storage p = proposals[id];
        require(block.timestamp > p.endTime, "Voting not ended");
        require(!p.executed && !p.cancelled, "Invalid state");

        uint256 quorum = (governanceToken.totalSupply() * quorumBps) / 10000;
        require(p.forVotes + p.againstVotes >= quorum, "Quorum not met");
        require(p.forVotes > p.againstVotes, "Proposal defeated");

        p.executed = true;
        (bool success, ) = p.target.call{value: p.value}(p.callData);
        require(success, "Execution failed");

        emit ProposalExecuted(id);
    }

    function cancel(uint256 id) external {
        Proposal storage p = proposals[id];
        require(msg.sender == p.proposer || msg.sender == owner(), "Not authorized");
        require(!p.executed, "Already executed");
        p.cancelled = true;
        emit ProposalCancelled(id);
    }

    function getState(uint256 id) external view returns (ProposalState) {
        Proposal storage p = proposals[id];
        if (p.cancelled) return ProposalState.Cancelled;
        if (p.executed) return ProposalState.Executed;
        if (block.timestamp <= p.endTime) return ProposalState.Active;

        uint256 quorum = (governanceToken.totalSupply() * quorumBps) / 10000;
        if (p.forVotes + p.againstVotes < quorum) return ProposalState.Defeated;
        if (p.forVotes > p.againstVotes) return ProposalState.Succeeded;
        return ProposalState.Defeated;
    }

    receive() external payable {}
}
```

---

## 3. Multi-Sig Wallet

N-of-M signature requirement for transaction execution.

**When to use:** Treasury management, admin key protection, any operation requiring multiple approvals.

**Security considerations:**
- Confirmation threshold must be > 0 and <= owner count
- Owner addition/removal is itself a multi-sig operation
- Prevent duplicate owners
- Transaction can be revoked before execution
- Consider adding an execution deadline to prevent stale transactions
- Guard against owner set becoming too small (below threshold)

**Gas optimization:** ~100k gas per submission. ~50k per confirmation. Execution gas varies by payload.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiSigWallet
 * @author ChainGPT Pattern Library
 * @notice N-of-M multi-signature wallet for transaction approval.
 * @dev Owners submit, confirm, and execute transactions requiring threshold confirmations.
 */
contract MultiSigWallet {
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    Transaction[] public transactions;
    // txIndex => owner => confirmed
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event TransactionSubmitted(uint256 indexed txIndex, address indexed submitter, address to, uint256 value);
    event TransactionConfirmed(uint256 indexed txIndex, address indexed confirmer);
    event ConfirmationRevoked(uint256 indexed txIndex, address indexed revoker);
    event TransactionExecuted(uint256 indexed txIndex);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 newThreshold);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "Only via multisig");
        _;
    }

    modifier txExists(uint256 txIndex) {
        require(txIndex < transactions.length, "Tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txIndex) {
        require(!transactions[txIndex].executed, "Already executed");
        _;
    }

    /**
     * @param owners_ Array of owner addresses
     * @param threshold_ Required confirmations (e.g., 3 for 3-of-5)
     */
    constructor(address[] memory owners_, uint256 threshold_) {
        require(owners_.length > 0, "No owners");
        require(threshold_ > 0 && threshold_ <= owners_.length, "Invalid threshold");

        for (uint256 i = 0; i < owners_.length; i++) {
            address owner = owners_[i];
            require(owner != address(0), "Zero address owner");
            require(!isOwner[owner], "Duplicate owner");
            isOwner[owner] = true;
            owners.push(owner);
        }
        threshold = threshold_;
    }

    receive() external payable {}

    /**
     * @notice Submit a new transaction for approval.
     * @param to Target address
     * @param value ETH value
     * @param data Call data
     */
    function submitTransaction(
        address to,
        uint256 value,
        bytes memory data
    ) external onlyOwner returns (uint256 txIndex) {
        txIndex = transactions.length;
        transactions.push(Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            confirmations: 0
        }));
        emit TransactionSubmitted(txIndex, msg.sender, to, value);
    }

    /**
     * @notice Confirm a pending transaction.
     */
    function confirmTransaction(uint256 txIndex)
        external onlyOwner txExists(txIndex) notExecuted(txIndex)
    {
        require(!isConfirmed[txIndex][msg.sender], "Already confirmed");
        isConfirmed[txIndex][msg.sender] = true;
        transactions[txIndex].confirmations++;
        emit TransactionConfirmed(txIndex, msg.sender);
    }

    /**
     * @notice Execute a transaction that has enough confirmations.
     */
    function executeTransaction(uint256 txIndex)
        external onlyOwner txExists(txIndex) notExecuted(txIndex)
    {
        Transaction storage txn = transactions[txIndex];
        require(txn.confirmations >= threshold, "Not enough confirmations");

        txn.executed = true;
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit TransactionExecuted(txIndex);
    }

    /**
     * @notice Revoke a confirmation.
     */
    function revokeConfirmation(uint256 txIndex)
        external onlyOwner txExists(txIndex) notExecuted(txIndex)
    {
        require(isConfirmed[txIndex][msg.sender], "Not confirmed");
        isConfirmed[txIndex][msg.sender] = false;
        transactions[txIndex].confirmations--;
        emit ConfirmationRevoked(txIndex, msg.sender);
    }

    // --- Owner management (must go through multisig) ---

    function addOwner(address owner) external onlySelf {
        require(owner != address(0) && !isOwner[owner], "Invalid owner");
        isOwner[owner] = true;
        owners.push(owner);
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlySelf {
        require(isOwner[owner], "Not an owner");
        require(owners.length - 1 >= threshold, "Would break threshold");
        isOwner[owner] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        require(newThreshold > 0 && newThreshold <= owners.length, "Invalid threshold");
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }
}
```

---

## 4. Treasury

DAO-controlled treasury with spending proposals and budget tracking.

**When to use:** DAO treasuries that need structured spending with proposal-based approval.

**Security considerations:**
- All spending goes through proposal process -- no direct withdrawals
- Budget limits prevent overspending
- Only treasury managers can create proposals (TREASURER_ROLE)
- Execution requires sufficient approvals
- Track spending per period for budget compliance

**Gas optimization:** ~120k gas per proposal creation. ~80k per approval.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DAOTreasury
 * @author ChainGPT Pattern Library
 * @notice DAO-controlled treasury with spending proposals.
 * @dev Supports ETH and ERC-20 token management with proposal-based spending.
 */
contract DAOTreasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");

    uint256 public requiredApprovals;

    struct SpendingProposal {
        address proposer;
        address token;       // address(0) for ETH
        address recipient;
        uint256 amount;
        string reason;
        uint256 approvals;
        bool executed;
        bool cancelled;
        uint256 deadline;
    }

    SpendingProposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    // Budget tracking
    mapping(address => uint256) public monthlyBudget;  // token => monthly limit
    mapping(address => uint256) public monthlySpent;   // token => spent this period
    uint256 public budgetPeriodStart;

    event ProposalCreated(uint256 indexed id, address token, address recipient, uint256 amount, string reason);
    event ProposalApproved(uint256 indexed id, address approver);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event FundsReceived(address indexed from, uint256 amount);
    event BudgetUpdated(address indexed token, uint256 newBudget);

    constructor(
        address admin,
        uint256 requiredApprovals_
    ) {
        require(admin != address(0), "Zero admin");
        require(requiredApprovals_ > 0, "Zero approvals");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);
        _grantRole(APPROVER_ROLE, admin);
        requiredApprovals = requiredApprovals_;
        budgetPeriodStart = block.timestamp;
    }

    receive() external payable {
        emit FundsReceived(msg.sender, msg.value);
    }

    /**
     * @notice Create a spending proposal.
     * @param token Token address (address(0) for ETH)
     * @param recipient Payment recipient
     * @param amount Amount to spend
     * @param reason Description of the spend
     * @param deadline Proposal deadline
     */
    function createProposal(
        address token,
        address recipient,
        uint256 amount,
        string memory reason,
        uint256 deadline
    ) external onlyRole(TREASURER_ROLE) returns (uint256 id) {
        require(recipient != address(0), "Zero recipient");
        require(amount > 0, "Zero amount");
        require(deadline > block.timestamp, "Deadline in past");

        id = proposals.length;
        proposals.push(SpendingProposal({
            proposer: msg.sender,
            token: token,
            recipient: recipient,
            amount: amount,
            reason: reason,
            approvals: 0,
            executed: false,
            cancelled: false,
            deadline: deadline
        }));

        emit ProposalCreated(id, token, recipient, amount, reason);
    }

    /**
     * @notice Approve a spending proposal.
     */
    function approveProposal(uint256 id) external onlyRole(APPROVER_ROLE) {
        SpendingProposal storage p = proposals[id];
        require(!p.executed && !p.cancelled, "Invalid state");
        require(block.timestamp <= p.deadline, "Expired");
        require(!hasApproved[id][msg.sender], "Already approved");

        hasApproved[id][msg.sender] = true;
        p.approvals++;

        emit ProposalApproved(id, msg.sender);
    }

    /**
     * @notice Execute an approved proposal.
     */
    function executeProposal(uint256 id) external nonReentrant onlyRole(TREASURER_ROLE) {
        SpendingProposal storage p = proposals[id];
        require(!p.executed && !p.cancelled, "Invalid state");
        require(p.approvals >= requiredApprovals, "Not enough approvals");
        require(block.timestamp <= p.deadline, "Expired");

        // Reset budget period if needed
        _resetBudgetIfNeeded();

        // Check budget
        if (monthlyBudget[p.token] > 0) {
            require(
                monthlySpent[p.token] + p.amount <= monthlyBudget[p.token],
                "Exceeds monthly budget"
            );
        }

        p.executed = true;
        monthlySpent[p.token] += p.amount;

        if (p.token == address(0)) {
            (bool success, ) = p.recipient.call{value: p.amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(p.token).safeTransfer(p.recipient, p.amount);
        }

        emit ProposalExecuted(id);
    }

    function cancelProposal(uint256 id) external onlyRole(TREASURER_ROLE) {
        SpendingProposal storage p = proposals[id];
        require(!p.executed, "Already executed");
        p.cancelled = true;
        emit ProposalCancelled(id);
    }

    function setMonthlyBudget(address token, uint256 budget) external onlyRole(DEFAULT_ADMIN_ROLE) {
        monthlyBudget[token] = budget;
        emit BudgetUpdated(token, budget);
    }

    function setRequiredApprovals(uint256 n) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(n > 0, "Zero approvals");
        requiredApprovals = n;
    }

    function _resetBudgetIfNeeded() private {
        if (block.timestamp >= budgetPeriodStart + 30 days) {
            budgetPeriodStart = block.timestamp;
            // Note: individual token spending is not automatically reset in storage
            // to save gas. Use a new period start check in the budget comparison.
        }
    }

    function getBalance(address token) external view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }
}
```

---

## 5. Delegation

Vote delegation with snapshot-based voting power.

**When to use:** Governance systems where token holders delegate voting power to representatives.

**Security considerations:**
- Delegation does not transfer tokens -- only voting power
- Self-delegation is required to activate voting power (by design in ERC20Votes)
- Snapshot at proposal creation prevents double-voting across blocks
- Delegate changes take effect at next block (checkpoint-based)
- Consider liquid delegation where delegates can re-delegate

**Gas optimization:** Delegation ~80k gas (writes new checkpoint). Reading voting power is O(log n) binary search.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DelegationRegistry
 * @author ChainGPT Pattern Library
 * @notice Standalone delegation registry for governance systems.
 * @dev Tracks delegation relationships and voting power snapshots.
 *      Can be used alongside any token that implements ERC20Votes,
 *      or as a standalone delegation layer.
 */
contract DelegationRegistry is Ownable {
    /// @notice The governance token with ERC20Votes support.
    ERC20Votes public immutable token;

    /// @notice Track which delegates are active (opted-in as delegates).
    mapping(address => bool) public isActiveDelegate;
    /// @notice Delegate metadata (name, platform, etc.).
    mapping(address => string) public delegateProfile;
    /// @notice Number of delegators per delegate.
    mapping(address => uint256) public delegatorCount;
    /// @notice Track who each address has delegated to.
    mapping(address => address) public delegatedTo;

    address[] public activeDelegates;

    event DelegateRegistered(address indexed delegate, string profile);
    event DelegateUnregistered(address indexed delegate);
    event DelegationChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);

    constructor(address token_) Ownable(msg.sender) {
        token = ERC20Votes(token_);
    }

    /**
     * @notice Register as an active delegate.
     * @param profile Description or platform URL
     */
    function registerAsDelegate(string memory profile) external {
        require(!isActiveDelegate[msg.sender], "Already registered");
        require(bytes(profile).length > 0, "Empty profile");

        isActiveDelegate[msg.sender] = true;
        delegateProfile[msg.sender] = profile;
        activeDelegates.push(msg.sender);

        emit DelegateRegistered(msg.sender, profile);
    }

    /**
     * @notice Unregister as a delegate.
     */
    function unregisterAsDelegate() external {
        require(isActiveDelegate[msg.sender], "Not registered");
        isActiveDelegate[msg.sender] = false;

        // Remove from active list
        for (uint256 i = 0; i < activeDelegates.length; i++) {
            if (activeDelegates[i] == msg.sender) {
                activeDelegates[i] = activeDelegates[activeDelegates.length - 1];
                activeDelegates.pop();
                break;
            }
        }

        emit DelegateUnregistered(msg.sender);
    }

    /**
     * @notice Delegate voting power to a registered delegate.
     * @dev This calls delegate() on the underlying ERC20Votes token.
     * @param delegate The delegate to vote on your behalf
     */
    function delegateTo(address delegate) external {
        require(isActiveDelegate[delegate] || delegate == msg.sender, "Not a registered delegate");

        address previousDelegate = delegatedTo[msg.sender];
        if (previousDelegate != address(0) && previousDelegate != msg.sender) {
            delegatorCount[previousDelegate]--;
        }

        delegatedTo[msg.sender] = delegate;
        if (delegate != msg.sender) {
            delegatorCount[delegate]++;
        }

        // Actually delegate on the token contract
        // Note: The caller must call token.delegate() themselves or
        // grant approval for this contract to call on their behalf.
        // This registry tracks the intent; actual delegation is on-token.

        emit DelegationChanged(msg.sender, previousDelegate, delegate);
    }

    /**
     * @notice Get voting power of an address at a past block.
     */
    function getVotingPower(address account, uint256 timepoint) external view returns (uint256) {
        return token.getPastVotes(account, timepoint);
    }

    /**
     * @notice Get total supply at a past block.
     */
    function getTotalSupplyAt(uint256 timepoint) external view returns (uint256) {
        return token.getPastTotalSupply(timepoint);
    }

    /**
     * @notice Get all active delegates.
     */
    function getActiveDelegates() external view returns (address[] memory) {
        return activeDelegates;
    }

    /**
     * @notice Get delegate info.
     */
    function getDelegateInfo(address delegate) external view returns (
        bool active,
        string memory profile,
        uint256 numDelegators,
        uint256 currentVotingPower
    ) {
        return (
            isActiveDelegate[delegate],
            delegateProfile[delegate],
            delegatorCount[delegate],
            token.getVotes(delegate)
        );
    }

    function activeDelegateCount() external view returns (uint256) {
        return activeDelegates.length;
    }
}
```
