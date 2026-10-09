// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ORIGINX Proof Anchor
/// @notice Public, append-only registry of cryptographic proofs for physical product identities
///         and their lifecycle events.
/// @dev Only 32-byte hashes are stored. No product history, organization data, documents or
///      personal data ever touch the chain. The ORIGINX backend computes every hash server-side.
contract OriginXProofAnchor {
    // Identity status codes mirrored from the ORIGINX ProductIdentity model.
    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_SUSPENDED = 2;
    uint8 public constant STATUS_RECALLED = 3;
    uint8 public constant STATUS_COUNTERFEIT = 4;
    uint8 public constant STATUS_REVOKED = 5;

    struct IdentityRecord {
        uint64 registeredAt;
        uint8 status;
        address registrar;
    }

    struct EventRecord {
        bytes32 identityHash;
        uint64 anchoredAt;
    }

    address public owner;
    mapping(address => bool) public anchorers;
    mapping(bytes32 => IdentityRecord) private identities;
    mapping(bytes32 => EventRecord) private eventAnchors;
    uint256 public identityCount;
    uint256 public eventCount;

    event AnchorerUpdated(address indexed account, bool allowed);
    event IdentityRegistered(bytes32 indexed identityHash, address indexed registrar, uint256 timestamp);
    event IdentityStatusChanged(bytes32 indexed identityHash, uint8 status, uint256 timestamp);
    event EventAnchored(bytes32 indexed eventHash, bytes32 indexed identityHash, uint256 timestamp);

    error NotOwner();
    error NotAnchorer();
    error EmptyHash();
    error IdentityAlreadyRegistered(bytes32 identityHash);
    error IdentityNotRegistered(bytes32 identityHash);
    error EventAlreadyAnchored(bytes32 eventHash);
    error InvalidStatus(uint8 status);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAnchorer() {
        if (!anchorers[msg.sender]) revert NotAnchorer();
        _;
    }

    constructor() {
        owner = msg.sender;
        anchorers[msg.sender] = true;
        emit AnchorerUpdated(msg.sender, true);
    }

    function setAnchorer(address account, bool allowed) external onlyOwner {
        anchorers[account] = allowed;
        emit AnchorerUpdated(account, allowed);
    }

    /// @notice Registers a canonical product identity. A hash can only ever be registered once,
    ///         which makes the chain a global first-registrant record for identity collisions.
    function registerProductIdentity(bytes32 identityHash) external onlyAnchorer {
        if (identityHash == bytes32(0)) revert EmptyHash();
        if (identities[identityHash].registeredAt != 0) revert IdentityAlreadyRegistered(identityHash);
        identities[identityHash] = IdentityRecord(uint64(block.timestamp), STATUS_ACTIVE, msg.sender);
        identityCount += 1;
        emit IdentityRegistered(identityHash, msg.sender, block.timestamp);
    }

    /// @notice Records a status change (e.g. RECALLED) so it cannot be silently removed off-chain.
    function setIdentityStatus(bytes32 identityHash, uint8 status) external onlyAnchorer {
        if (identities[identityHash].registeredAt == 0) revert IdentityNotRegistered(identityHash);
        if (status < STATUS_ACTIVE || status > STATUS_REVOKED) revert InvalidStatus(status);
        identities[identityHash].status = status;
        emit IdentityStatusChanged(identityHash, status, block.timestamp);
    }

    /// @notice Anchors one lifecycle event hash, bound to a registered identity. Write-once.
    function anchorEventProof(bytes32 eventHash, bytes32 identityHash) external onlyAnchorer {
        if (eventHash == bytes32(0)) revert EmptyHash();
        if (identities[identityHash].registeredAt == 0) revert IdentityNotRegistered(identityHash);
        if (eventAnchors[eventHash].anchoredAt != 0) revert EventAlreadyAnchored(eventHash);
        eventAnchors[eventHash] = EventRecord(identityHash, uint64(block.timestamp));
        eventCount += 1;
        emit EventAnchored(eventHash, identityHash, block.timestamp);
    }

    function getIdentity(bytes32 identityHash)
        external
        view
        returns (bool exists, uint64 registeredAt, uint8 status, address registrar)
    {
        IdentityRecord memory record = identities[identityHash];
        return (record.registeredAt != 0, record.registeredAt, record.status, record.registrar);
    }

    function getEventAnchor(bytes32 eventHash)
        external
        view
        returns (bool exists, bytes32 identityHash, uint64 anchoredAt)
    {
        EventRecord memory record = eventAnchors[eventHash];
        return (record.anchoredAt != 0, record.identityHash, record.anchoredAt);
    }
}
