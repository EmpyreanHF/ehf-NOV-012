/* =============================================================================
   EMPYREAN INTERNATIONAL — SMART CONTRACT CONFIGURATION
   app-contracts.js  |  Step 0.4  |  Refactor Roadmap v1.0
   =============================================================================

   CRYPTO_HIDDEN_FOR_PLAY_STORE (2026-08, verified this session): this file
   is pure on-chain contract metadata (addresses/ABIs) — it never renders
   anything and never runs on its own. A repo-wide search confirms nothing
   else currently references window.EmpContracts / contractAddresses /
   contractABIs (app-admin.js's own vault code keeps its own inline copy of
   these same addresses, and that code path is itself unreachable — see the
   CRYPTO_HIDDEN_FOR_PLAY_STORE note at the top of its Disbursements
   section). So this file is fully inert on every current screen. Left in
   place as-is (data only, nothing to hide) rather than deleted, so wallet
   instantiation has a source of truth to resume from once crypto features
   are restored.

   PURPOSE
   ───────
   Single source of truth for all on-chain contract metadata.
   Extracted from the original DOMContentLoaded closure in app-fixes.js.

   LOAD ORDER
   ──────────
   <script src="firebase-init.js">
   <script src="app-state.js">
   <script src="app-helpers.js">
   <script src="app-contracts.js">   ← THIS FILE (no other app-*.js deps)
   ... remaining modules ...

   DEPENDS ON
   ──────────
   • ethers.js — must be loaded via CDN before this file is used at runtime.
     This module only defines data; it does not instantiate contracts.
     Contract instantiation is done by app-wallet.js after the user connects
     a wallet.

   NETWORK
   ───────
   All contracts are deployed on Polygon Mainnet (chainId 137).
   The module exposes EmpContracts.NETWORK for wallet connection validation.

   NAMESPACE
   ─────────
   window.EmpContracts — canonical namespace
   window.contractAddresses — backward-compat shim (same object reference)
   window.contractABIs      — backward-compat shim (same object reference)

   SECTION MAP
   ───────────
   §1  Network config         — chain ID, RPC URL, block explorer
   §2  Contract addresses     — 4 deployed contract addresses
   §3  Standard ERC-20 ABI    — used by EmpyreanToken
   §4  EmpyDistribution ABI   — reward recording and claiming
   §5  NgoAndGrantRegistry ABI— NGO registry, off-chain & on-chain grants
   §6  EmpyreanStaking ABI    — stake, unstake, claimReward, earned
   §7  ABI map                — keyed by contract name for easy lookup
   §8  Instantiation helper   — EmpContracts.getInstance(name, signerOrProvider)
   §9  Exports                — window bindings

   ============================================================================= */

(function empyreanContractsModule() {
    'use strict';

    if (window.EmpContracts && window.EmpContracts.__initialised) {
        console.warn('[EmpContracts] Already loaded — skipping duplicate.');
        return;
    }

    /* =========================================================================
       §1  NETWORK CONFIGURATION
       ========================================================================= */

    const NETWORK = {
        name:        'Polygon Mainnet',
        chainId:     137,
        chainIdHex:  '0x89',
        rpcUrl:      'https://polygon-rpc.com',
        explorer:    'https://polygonscan.com',
        nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 }
    };

    /* =========================================================================
       §2  CONTRACT ADDRESSES
       ========================================================================= */

    const contractAddresses = {
        EmpyreanToken:       '0x624ca3Db53adb41944EbF2BcB015f68C7BAB0c02',
        EmpyDistribution:    '0xf48ee3c90c9183fb4acd0d9e1ef8b49accfc470e',
        NgoAndGrantRegistry: '0xc861e3ae9a35336c9735692d788065c4a0e37ebb',
        EmpyreanStaking:     '0xba368a7b31f61748aef714ef779dd8086d38a1fc'
    };

    /* =========================================================================
       §3  STANDARD ERC-20 ABI
       Used by EmpyreanToken.  Covers the full EIP-20 surface plus common
       extensions (mint, burn, permit) for future use.
       ========================================================================= */

    const ERC20_ABI = [
        /* ── Read ── */
        { inputs: [],                                                               name: 'name',        outputs: [{ internalType: 'string',  name: '', type: 'string'  }], stateMutability: 'view',     type: 'function' },
        { inputs: [],                                                               name: 'symbol',      outputs: [{ internalType: 'string',  name: '', type: 'string'  }], stateMutability: 'view',     type: 'function' },
        { inputs: [],                                                               name: 'decimals',    outputs: [{ internalType: 'uint8',   name: '', type: 'uint8'   }], stateMutability: 'view',     type: 'function' },
        { inputs: [],                                                               name: 'totalSupply', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view',     type: 'function' },
        { inputs: [{ internalType: 'address', name: 'account', type: 'address' }], name: 'balanceOf',   outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view',     type: 'function' },
        { inputs: [{ internalType: 'address', name: 'owner', type: 'address' }, { internalType: 'address', name: 'spender', type: 'address' }],
          name: 'allowance', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },

        /* ── Write ── */
        { inputs: [{ internalType: 'address', name: 'to',      type: 'address' }, { internalType: 'uint256', name: 'amount',  type: 'uint256' }],
          name: 'transfer',     outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'spender', type: 'address' }, { internalType: 'uint256', name: 'amount',  type: 'uint256' }],
          name: 'approve',      outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'from',    type: 'address' }, { internalType: 'address', name: 'to',      type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }],
          name: 'transferFrom', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },

        /* ── Events ── */
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'from',    type: 'address' },
            { indexed: true,  internalType: 'address', name: 'to',      type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'value',   type: 'uint256' }
          ], name: 'Transfer', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'owner',   type: 'address' },
            { indexed: true,  internalType: 'address', name: 'spender', type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'value',   type: 'uint256' }
          ], name: 'Approval', type: 'event' }
    ];

    /* =========================================================================
       §4  EMPY DISTRIBUTION ABI
       Contract: EmpyDistribution
       Purpose: Platform records off-chain impact-mining rewards;
                users call claimRewards() to withdraw to their wallet.
       Key functions:
         recordRewards(user, amount)   — admin only
         claimRewards()                — user pulls their balance
         getClaimableBalance(user)     — read user's claimable amount
         minimumWithdrawal()           — minimum claim threshold
       ========================================================================= */

    const EMPY_DISTRIBUTION_ABI = [
        /* ── Constructor ── */
        { inputs: [
            { internalType: 'address', name: '_empyTokenAddress', type: 'address' },
            { internalType: 'address', name: '_initialOwner',     type: 'address' },
            { internalType: 'uint256', name: '_minimumWithdrawal',type: 'uint256' }
          ], stateMutability: 'nonpayable', type: 'constructor' },

        /* ── Errors ── */
        { inputs: [{ internalType: 'address', name: 'owner',   type: 'address' }], name: 'OwnableInvalidOwner',       type: 'error' },
        { inputs: [{ internalType: 'address', name: 'account', type: 'address' }], name: 'OwnableUnauthorizedAccount', type: 'error' },
        { inputs: [{ internalType: 'address', name: 'token',   type: 'address' }], name: 'SafeERC20FailedOperation',   type: 'error' },

        /* ── Events ── */
        { anonymous: false, inputs: [{ indexed: false, internalType: 'uint256', name: 'newMinimum', type: 'uint256' }],
          name: 'MinimumWithdrawalUpdated', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'previousOwner', type: 'address' },
            { indexed: true,  internalType: 'address', name: 'newOwner',      type: 'address' }
          ], name: 'OwnershipTransferred', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'user',   type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
          ], name: 'RewardsClaimed', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'user',   type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
          ], name: 'RewardsRecorded', type: 'event' },

        /* ── Read ── */
        { inputs: [],                                                                      name: 'empyToken',          outputs: [{ internalType: 'contract IERC20', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                      name: 'minimumWithdrawal',  outputs: [{ internalType: 'uint256',         name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                      name: 'owner',              outputs: [{ internalType: 'address',         name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                      name: 'totalClaimed',       outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: '',     type: 'address' }],           name: 'rewards',            outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'user', type: 'address' }],           name: 'getClaimableBalance',outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },

        /* ── Write ── */
        { inputs: [],                                                                      name: 'claimRewards',             outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [],                                                                      name: 'renounceOwnership',        outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'newOwner', type: 'address' }],       name: 'transferOwnership',        outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'user',   type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }],
          name: 'recordRewards', outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'uint256', name: 'newMinimum', type: 'uint56' }],
          name: 'updateMinimumWithdrawal', outputs: [], stateMutability: 'nonpayable', type: 'function' }
    ];

    /* =========================================================================
       §5  NGO & GRANT REGISTRY ABI
       Contract: NgoAndGrantRegistry
       Purpose: Maintains on-chain list of verified NGO partners and records
                both fiat (off-chain) and token (on-chain) grant disbursements
                for full auditability.
       Key functions:
         addNgo / delistNgo / updateNgoDetails  — admin NGO management
         recordOffChainGrant(recipient, amount, currency, projectId, txRef)
         recordOnChainGrant(recipient, tokenAddress, amount, projectId)
         getVerifiedNgos(offset, limit)
       ========================================================================= */

    const NGO_GRANT_REGISTRY_ABI = [
        /* ── Constructor ── */
        { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },

        /* ── Errors ── */
        { inputs: [{ internalType: 'address', name: 'owner',   type: 'address' }], name: 'OwnableInvalidOwner',       type: 'error' },
        { inputs: [{ internalType: 'address', name: 'account', type: 'address' }], name: 'OwnableUnauthorizedAccount', type: 'error' },

        /* ── Events ── */
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'ngoAddress', type: 'address' },
            { indexed: false, internalType: 'string',  name: 'name',       type: 'string'  }
          ], name: 'NgoAdded', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true, internalType: 'address', name: 'ngoAddress', type: 'address' }
          ], name: 'NgoDelisted', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true, internalType: 'address', name: 'ngoAddress', type: 'address' }
          ], name: 'NgoUpdated', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'uint256', name: 'grantId',              type: 'uint256' },
            { indexed: true,  internalType: 'address', name: 'recipient',            type: 'address' },
            { indexed: false, internalType: 'string',  name: 'currency',             type: 'string'  },
            { indexed: false, internalType: 'uint256', name: 'amount',               type: 'uint256' },
            { indexed: false, internalType: 'string',  name: 'projectId',            type: 'string'  },
            { indexed: false, internalType: 'string',  name: 'transactionReference', type: 'string'  }
          ], name: 'OffChainGrantDisbursed', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'uint256', name: 'grantId',      type: 'uint256' },
            { indexed: true,  internalType: 'address', name: 'recipient',    type: 'address' },
            { indexed: true,  internalType: 'address', name: 'tokenAddress', type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'amount',       type: 'uint256' },
            { indexed: false, internalType: 'string',  name: 'projectId',    type: 'string'  }
          ], name: 'OnChainGrantDisbursed', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'previousOwner', type: 'address' },
            { indexed: true,  internalType: 'address', name: 'newOwner',      type: 'address' }
          ], name: 'OwnershipTransferred', type: 'event' },

        /* ── Read ── */
        { inputs: [],                                                              name: 'getOffChainGrantCount',  outputs: [{ internalType: 'uint256',  name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                              name: 'getOnChainGrantCount',   outputs: [{ internalType: 'uint256',  name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                              name: 'getVerifiedNgoCount',    outputs: [{ internalType: 'uint256',  name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                              name: 'owner',                  outputs: [{ internalType: 'address',  name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'uint256', name: '_offset', type: 'uint256' }, { internalType: 'uint256', name: '_limit', type: 'uint256' }],
          name: 'getVerifiedNgos', outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'uint56',  name: '', type: 'uint56'  }], name: 'ngoAddressList',  outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'ngos',
          outputs: [
            { internalType: 'string',  name: 'name',       type: 'string'  },
            { internalType: 'string',  name: 'detailsUrl', type: 'string'  },
            { internalType: 'bool',    name: 'isVerified', type: 'bool'    },
            { internalType: 'uint256', name: 'listIndex',  type: 'uint256' }
          ], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'uint56', name: '', type: 'uint56' }], name: 'offChainGrants',
          outputs: [
            { internalType: 'address', name: 'recipient',            type: 'address' },
            { internalType: 'string',  name: 'currency',             type: 'string'  },
            { internalType: 'uint256', name: 'amount',               type: 'uint256' },
            { internalType: 'string',  name: 'projectId',            type: 'string'  },
            { internalType: 'string',  name: 'transactionReference', type: 'string'  },
            { internalType: 'uint256', name: 'timestamp',            type: 'uint256' }
          ], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'uint56', name: '', type: 'uint56' }], name: 'onChainGrants',
          outputs: [
            { internalType: 'address', name: 'recipient',    type: 'address' },
            { internalType: 'address', name: 'tokenAddress', type: 'address' },
            { internalType: 'uint256', name: 'amount',       type: 'uint256' },
            { internalType: 'string',  name: 'projectId',    type: 'string'  },
            { internalType: 'uint256', name: 'timestamp',    type: 'uint256' }
          ], stateMutability: 'view', type: 'function' },

        /* ── Write ── */
        { inputs: [
            { internalType: 'address', name: '_ngoAddress', type: 'address' },
            { internalType: 'string',  name: '_name',       type: 'string'  },
            { internalType: 'string',  name: '_detailsUrl', type: 'string'  }
          ], name: 'addNgo',          outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: '_ngoAddress', type: 'address' }],
          name: 'delistNgo',         outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [],                name: 'renounceOwnership',   outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'newOwner',   type: 'address' }],
          name: 'transferOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [
            { internalType: 'address', name: '_ngoAddress', type: 'address' },
            { internalType: 'string',  name: '_name',       type: 'string'  },
            { internalType: 'string',  name: '_detailsUrl', type: 'string'  }
          ], name: 'updateNgoDetails', outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [
            { internalType: 'address', name: '_recipient',           type: 'address' },
            { internalType: 'uint256', name: '_amount',              type: 'uint256' },
            { internalType: 'string',  name: '_currency',            type: 'string'  },
            { internalType: 'string',  name: '_projectId',           type: 'string'  },
            { internalType: 'string',  name: '_transactionReference',type: 'string'  }
          ], name: 'recordOffChainGrant', outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [
            { internalType: 'address', name: '_recipient',    type: 'address' },
            { internalType: 'address', name: '_tokenAddress', type: 'address' },
            { internalType: 'uint256', name: '_amount',       type: 'uint256' },
            { internalType: 'string',  name: '_projectId',   type: 'string'  }
          ], name: 'recordOnChainGrant', outputs: [], stateMutability: 'nonpayable', type: 'function' }
    ];

    /* =========================================================================
       §6  EMPYREAN STAKING ABI
       Contract: EmpyreanStaking
       Purpose: Users stake EMPY tokens to earn compounding rewards.
                Rewards are calculated per-token and claimed separately.
       Key functions:
         stake(amount)     — lock EMPY, begin earning
         unstake(amount)   — withdraw staked principal
         claimReward()     — pull accrued staking yield
         earned(account)   — read pending rewards for any address
         balanceOf(account)— staked balance
       ========================================================================= */

    const EMPYREAN_STAKING_ABI = [
        /* ── Constructor ── */
        { inputs: [
            { internalType: 'address', name: '_empyTokenAddress',          type: 'address' },
            { internalType: 'address', name: '_rewardsDistributionAddress',type: 'address' }
          ], stateMutability: 'nonpayable', type: 'constructor' },

        /* ── Errors ── */
        { inputs: [{ internalType: 'address', name: 'owner',   type: 'address' }], name: 'OwnableInvalidOwner',       type: 'error' },
        { inputs: [{ internalType: 'address', name: 'account', type: 'address' }], name: 'OwnableUnauthorizedAccount', type: 'error' },

        /* ── Events ── */
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'previousOwner', type: 'address' },
            { indexed: true,  internalType: 'address', name: 'newOwner',      type: 'address' }
          ], name: 'OwnershipTransferred', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'user',   type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'reward', type: 'uint256' }
          ], name: 'RewardPaid', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: false, internalType: 'uint256', name: 'newRate', type: 'uint256' }
          ], name: 'RewardRateUpdated', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'user',   type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
          ], name: 'Staked', type: 'event' },
        { anonymous: false, inputs: [
            { indexed: true,  internalType: 'address', name: 'user',   type: 'address' },
            { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
          ], name: 'Unstaked', type: 'event' },

        /* ── Read ── */
        { inputs: [],                                                                name: 'empyToken',                  outputs: [{ internalType: 'contract IERC20', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'lastUpdateTime',             outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'owner',                      outputs: [{ internalType: 'address',         name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'rewardPerToken',             outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'rewardPerTokenStored',       outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'rewardRate',                 outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'rewardsDistributionContract',outputs: [{ internalType: 'address',         name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
        { inputs: [],                                                                name: 'totalSupply',                outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: '_account', type: 'address' }], name: 'earned',                     outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: '',         type: 'address' }], name: 'balanceOf',                  outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: '',         type: 'address' }], name: 'rewards',                    outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ internalType: 'address', name: '',         type: 'address' }], name: 'userRewardPerTokenPaid',     outputs: [{ internalType: 'uint256',         name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },

        /* ── Write ── */
        { inputs: [],                                                               name: 'claimReward',       outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [],                                                               name: 'renounceOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'address', name: 'newOwner',  type: 'address'  }], name: 'transferOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'uint256', name: '_newRate',  type: 'uint256'  }], name: 'setRewardRate',     outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'uint256', name: '_amount',   type: 'uint56'   }], name: 'stake',             outputs: [], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ internalType: 'uint256', name: '_amount',   type: 'uint56'   }], name: 'unstake',           outputs: [], stateMutability: 'nonpayable', type: 'function' }
    ];

    /* =========================================================================
       §7  ABI MAP — keyed by contract name
       ========================================================================= */

    const contractABIs = {
        EmpyreanToken:       ERC20_ABI,
        EmpyDistribution:    EMPY_DISTRIBUTION_ABI,
        NgoAndGrantRegistry: NGO_GRANT_REGISTRY_ABI,
        EmpyreanStaking:     EMPYREAN_STAKING_ABI
    };

    /* =========================================================================
       §8  INSTANTIATION HELPER
       ========================================================================= */

    /**
     * Return an ethers.js Contract instance for a named contract.
     * Requires ethers.js to be loaded in the page.
     *
     * @param {string}           name              — Key from contractAddresses
     * @param {object}           signerOrProvider  — ethers Signer or Provider
     * @returns {ethers.Contract|null}
     *
     * @example
     *   const signer = await EmpContracts.getInstance('EmpyreanStaking', signer);
     *   const earned = await signer.earned(walletAddress);
     */
    function getInstance(name, signerOrProvider) {
        if (typeof ethers === 'undefined') {
            console.error('[EmpContracts] ethers.js is not loaded.');
            return null;
        }
        var address = contractAddresses[name];
        var abi     = contractABIs[name];
        if (!address || !abi) {
            console.error('[EmpContracts] Unknown contract:', name);
            return null;
        }
        return new ethers.Contract(address, abi, signerOrProvider);
    }

    /**
     * Verify the connected wallet is on the correct network (Polygon Mainnet).
     * Returns true if chainId matches; false with a descriptive console warning otherwise.
     *
     * @param {number|string} chainId — Connected chain ID
     * @returns {boolean}
     */
    function isCorrectNetwork(chainId) {
        var id = parseInt(chainId, 16) || parseInt(chainId, 10);
        if (id !== NETWORK.chainId) {
            console.warn(
                '[EmpContracts] Wrong network. Expected',
                NETWORK.name, '(chainId ' + NETWORK.chainId + ').',
                'Got chainId:', id
            );
            return false;
        }
        return true;
    }

    /* =========================================================================
       §9  EXPORTS — window bindings
       ========================================================================= */

    const EmpContracts = {
        __initialised: true,
        NETWORK,
        addresses:  contractAddresses,
        abis:       contractABIs,
        getInstance,
        isCorrectNetwork,

        /* Named ABI references for direct import by app-wallet.js */
        ERC20_ABI,
        EMPY_DISTRIBUTION_ABI,
        NGO_GRANT_REGISTRY_ABI,
        EMPYREAN_STAKING_ABI
    };

    window.EmpContracts = EmpContracts;

    /* Backward-compatible shims — same object references */
    window.contractAddresses = contractAddresses;
    window.contractABIs      = contractABIs;

    console.log('[EmpContracts] ✅ Contract config ready. Network:', NETWORK.name,
        '| Contracts:', Object.keys(contractAddresses).join(', '));

})();