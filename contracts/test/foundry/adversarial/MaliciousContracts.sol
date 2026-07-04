// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

contract MaliciousReceiver {
    bool public shouldRevert;
    uint256 public callCount;
    bytes public lastCalldata;

    constructor(bool _shouldRevert) {
        shouldRevert = _shouldRevert;
    }

    receive() external payable {
        callCount++;
        if (shouldRevert) revert("MaliciousReceiver: attack!");
    }

    fallback() external payable {
        callCount++;
        if (shouldRevert) revert("MaliciousReceiver: fallback attack!");
    }

    function setShouldRevert(bool _val) external {
        shouldRevert = _val;
    }

    function attackExecute(address wallet) external {
        (bool ok,) = wallet.call(
            abi.encodeWithSignature("execute(address,uint256,bytes)", address(this), 0, "")
        );
    }
}

contract MaliciousReentrant {
    uint256 public attackCount;
    uint256 public maxAttacks;
    address public target;
    bytes public attackData;

    constructor(address _target, bytes memory _data, uint256 _maxAttacks) {
        target = _target;
        attackData = _data;
        maxAttacks = _maxAttacks;
    }

    receive() external payable {
        if (attackCount < maxAttacks) {
            attackCount++;
            (bool ok,) = target.call(attackData);
        }
    }
}

contract MaliciousFallback {
    bool public shouldConsumeGas;
    bool public shouldRevert;
    bool public shouldReturnRandomData;
    uint256 public callCount;

    function setGasGriefing(bool _val) external { shouldConsumeGas = _val; }
    function setRevert(bool _val) external { shouldRevert = _val; }
    function setRandomReturn(bool _val) external { shouldReturnRandomData = _val; }

    receive() external payable {
        callCount++;
        if (shouldConsumeGas) {
            uint256 i;
            while (i < 1000000) { i++; }
        }
        if (shouldRevert) revert("MaliciousFallback: attack!");
        if (shouldReturnRandomData) {
            assembly {
                mstore(0, 0xDEADBEEF)
                return(0, 32)
            }
        }
    }

    fallback() external payable {
        callCount++;
        if (shouldConsumeGas) {
            uint256 i;
            while (i < 1000000) { i++; }
        }
        if (shouldRevert) revert("MaliciousFallback: attack!");
    }
}

contract MaliciousDelegateCallTarget {
    uint256 public victimStorageSlot0;
    address public victimStorageSlot1;

    function attack(address target) external {
        (bool ok,) = target.call(
            abi.encodeWithSignature("execute(address,uint256,bytes)", address(this), 0, "")
        );
    }

    receive() external payable {}
}

contract GasGriefer {
    bool public active = true;
    uint256 public gasTarget;

    constructor(uint256 _gasTarget) {
        gasTarget = _gasTarget;
    }

    receive() external payable {
        if (active) {
            uint256 used;
            while (used < gasTarget) {
                used += 100;
            }
        }
    }

    function setActive(bool _active) external { active = _active; }
}

contract SelfDestructTarget {
    constructor() payable {}
    function destroy(address payable to) external {
        selfdestruct(to);
    }
    receive() external payable {}
}

contract ReturnDataBomb {
    uint256 public bombSize;

    constructor(uint256 _bombSize) {
        bombSize = _bombSize;
    }

    fallback() external payable {
        uint256 size = bombSize;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x20)
            for { let i := 0 } lt(i, size) { i := add(i, 32) } {
                mstore(add(ptr, add(0x20, i)), 0xFF)
            }
            return(ptr, add(0x20, size))
        }
    }

    receive() external payable {}
}

contract ReentrancyAttacker {
    uint256 public depth;
    uint256 public maxDepth;
    address public target;
    bytes public payload;

    constructor(address _target, bytes memory _payload, uint256 _maxDepth) {
        target = _target;
        payload = _payload;
        maxDepth = _maxDepth;
    }

    function attack() external {
        depth = 0;
        (bool ok,) = target.call(payload);
    }

    receive() external payable {
        if (depth < maxDepth) {
            depth++;
            (bool ok,) = target.call(payload);
        }
    }
}
