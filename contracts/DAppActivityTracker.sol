// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DAppActivityTracker
/// @notice Append-only on-chain log of user activity (name + type + timestamp).
/// @dev Deployed independently on Arbitrum Sepolia (0x25bbdF712ce03D6Aa1090b912A9AF06F6deBBd47)
///      and Arbitrum One   (0x26cf943D673396aA29C3c3875d46e228186f8533).
contract DAppActivityTracker {
    struct Activity {
        address userAddress;
        string name;
        string activityType;
        uint256 timestamp;
    }

    Activity[] private activities;

    event ActivityLogged(
        address indexed userAddress,
        string name,
        string activityType,
        uint256 timestamp
    );

    function logActivity(string memory _name, string memory _activityType) public {
        activities.push(
            Activity({
                userAddress: msg.sender,
                name: _name,
                activityType: _activityType,
                timestamp: block.timestamp
            })
        );

        emit ActivityLogged(msg.sender, _name, _activityType, block.timestamp);
    }

    function getActivity(uint256 index)
        public
        view
        returns (address, string memory, string memory, uint256)
    {
        require(index < activities.length, "Invalid index");
        Activity memory a = activities[index];
        return (a.userAddress, a.name, a.activityType, a.timestamp);
    }

    function getTotalActivities() public view returns (uint256) {
        return activities.length;
    }

    function getAllActivities() public view returns (Activity[] memory) {
        return activities;
    }
}
