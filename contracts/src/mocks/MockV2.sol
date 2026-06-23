// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../CredentialRegistry.sol";
import "../SessionManager.sol";
import "../CapabilityRegistry.sol";
import "../DelegationManager.sol";
import "../OrganizationRegistry.sol";
import "../OrganizationCredentialAnchor.sol";

/// @title MockV2_CredentialRegistry — V2 upgrade that adds a version getter
contract MockV2_CredentialRegistry is CredentialRegistry {
    uint256 public constant VERSION = 2;
}

/// @title MockV2_CapabilityRegistry — V2 upgrade that adds a version getter
contract MockV2_CapabilityRegistry is CapabilityRegistry {
    uint256 public constant VERSION = 2;
}

/// @title MockV2_SessionManager — V2 upgrade that adds a version getter
contract MockV2_SessionManager is SessionManager {
    uint256 public constant VERSION = 2;
}

/// @title MockV2_DelegationManager — V2 upgrade that adds a version getter
contract MockV2_DelegationManager is DelegationManager {
    uint256 public constant VERSION = 2;
}

/// @title MockV2_OrganizationRegistry — V2 upgrade that adds a version getter
contract MockV2_OrganizationRegistry is OrganizationRegistry {
    uint256 public constant VERSION = 2;
}
