/* eslint-disable no-console */
/* eslint-disable import/order */
import Web3 from 'web3'
import { ToastProgrammatic as Toast } from 'buefy'

import networkConfig from '@/networkConfig'

import ERC20ABI from '@/abis/Governance.abi.json'
import AggregatorABI from '@/abis/Aggregator.abi.json'

const { numberToHex, toWei, fromWei, toBN, hexToNumber, hexToNumberString } = require('web3-utils')

const state = () => {
  return {
    approvalAmount: 'unlimited',
    lockedBalance: '0',
    isFetchingLockedBalance: false,
    currentDelegate: '0x0000000000000000000000000000000000000000',
    timestamp: 0,
    delegatedBalance: '0',
    isFetchingDelegatedBalance: false,
    delegators: [],
    latestProposalId: {
      value: null,
      status: null
    },
    isFetchingProposals: true,
    proposals: [],
    voterReceipts: [],
    hasActiveProposals: false,
    constants: {
      EXECUTION_DELAY: 172800,
      EXECUTION_EXPIRATION: 259200,
      PROPOSAL_THRESHOLD: '1000000000000000000000',
      QUORUM_VOTES: '25000000000000000000000',
      VOTING_PERIOD: 432000
    }
  }
}

const getters = {
  govContract: (state, getters, rootState) => ({ netId }) => {
    const config = networkConfig[`netId${netId}`]
    const { url } = rootState.settings[`netId${netId}`].rpc
    const address = config['governance.contract.tornadocash.eth']
    if (address) {
      const web3 = new Web3(url)
      return new web3.eth.Contract(ERC20ABI, address)
    }

    return null
  },
  aggregatorContract: (state, getters, rootState, rootGetters) => {
    const { aggregatorContract } = rootGetters['metamask/networkConfig']
    const { url } = rootGetters['settings/currentRpc']
    const web3 = new Web3(url)
    return new web3.eth.Contract(AggregatorABI, aggregatorContract)
  },
  isFetchingProposals: ({ proposals, isFetchingProposals }) => {
    if (proposals && proposals.length && !isFetchingProposals) {
      return false
    }

    return isFetchingProposals
  },
  votingPower: (state) => {
    return toBN(state.lockedBalance)
      .add(toBN(state.delegatedBalance))
      .toString(10)
  },
  quorumVotes: (state, getters, rootState, rootGetters) => {
    return rootGetters['token/toDecimals'](state.constants.QUORUM_VOTES, 18)
  },
  votingPeriod: (state) => {
    return toBN(state.constants.VOTING_PERIOD)
      .divRound(toBN(24 * 60 * 60))
      .toNumber()
  },
  isEnabledGovernance: (state, getters, rootState, rootGetters) => {
    return Boolean(rootGetters['metamask/networkConfig']['governance.contract.tornadocash.eth'])
  },
  constants: (state) => {
    return state.constants
  },
  isFetchingBalances: (state) => {
    return state.isFetchingLockedBalance || state.isFetchingDelegatedBalance
  }
}

const mutations = {
  SET_APPROVAL_AMOUNT(state, { approvalAmount }) {
    state.approvalAmount = approvalAmount
  },
  SAVE_FETCHING_PROPOSALS(state, status) {
    this._vm.$set(state, 'isFetchingProposals', status)
  },
  SAVE_LOCKED_BALANCE(state, { balance }) {
    this._vm.$set(state, 'lockedBalance', balance)
  },
  SAVE_FETCHING_LOCKED_BALANCE(state, status) {
    this._vm.$set(state, 'isFetchingLockedBalance', status)
  },
  SAVE_LOCKED_TIMESTAMP(state, { timestamp }) {
    this._vm.$set(state, 'timestamp', timestamp)
  },
  SAVE_LATEST_PROPOSAL_ID(state, { id, status }) {
    this._vm.$set(state, 'latestProposalId', { value: id, status })
  },
  SAVE_DELEGATEE(state, { currentDelegate }) {
    this._vm.$set(state, 'currentDelegate', currentDelegate)
  },
  SAVE_PROPOSALS(state, proposals) {
    this._vm.$set(state, 'proposals', proposals)
  },
  SAVE_VOTER_RECEIPT(state, { hasVoted, support, balance, id }) {
    this._vm.$set(state.voterReceipts, id, { hasVoted, support, balance })
  },
  SAVE_DELEGATED_BALANCE(state, balance) {
    this._vm.$set(state, 'delegatedBalance', balance)
  },
  SAVE_FETCHING_DELEGATED_BALANCE(state, status) {
    this._vm.$set(state, 'isFetchingDelegatedBalance', status)
  },
  SAVE_DELEGATORS(state, uniq) {
    this._vm.$set(state, 'delegators', uniq)
  },
  SET_HAS_ACTIVE_PROPOSALS(state, condition) {
    this._vm.$set(state, 'hasActiveProposals', condition)
  },
  SAVE_CONSTANTS(state, constants) {
    this._vm.$set(state, 'constants', constants)
  }
}

// enum ProposalState { Pending, Active, Defeated, Timelocked, AwaitingExecution, Executed, Expired }

const ProposalState = [
  'pending',
  'active',
  'defeated',
  'timeLocked',
  'awaitingExecution',
  'executed',
  'expired'
]

const proposalIntervalConstants = [
  // 'CLOSING_PERIOD',
  'EXECUTION_DELAY',
  'EXECUTION_EXPIRATION',
  // 'VOTE_EXTEND_TIME',
  // 'VOTING_DELAY',
  'VOTING_PERIOD'
]
const govConstants = ['PROPOSAL_THRESHOLD', 'QUORUM_VOTES']

const actions = {
  async createProposal(
    { getters, rootGetters, state, commit, rootState, dispatch },
    { proposalAddress, title, description }
  ) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const json = JSON.stringify({ title, description })
      const data = await govInstance.methods.propose(proposalAddress, json).encodeABI()

      const gas = await govInstance.methods
        .propose(proposalAddress, json)
        .estimateGas({ from: ethAccount, value: 0 })

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 100000),
          data
        },
        watcherParams: {
          title: 'creatingProposal',
          successTitle: 'proposalCreated',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('torn/fetchTokenBalance', {}, { root: true })
          }
        },
        isSaving: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'Proposal',
          netId
        },
        { root: true }
      )

      await dispatch('fetchProposals', { requestId: state.proposals.length })

      this.$router.push('/governance')
    } catch (e) {
      console.error('createProposal', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    }
  },
  async lock({ getters, rootGetters, commit, rootState, dispatch }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']
      const { deadline, v, r, s } = rootState.torn.signature
      const govInstance = getters.govContract({ netId })
      const amount = toWei(rootState.torn.signature.amount.toString())
      const gas = await govInstance.methods
        .lock(ethAccount, amount, deadline, v, r, s)
        .estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.lock(ethAccount, amount, deadline, v, r, s).encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 30000),
          data
        },
        watcherParams: {
          title: 'locking',
          successTitle: 'lockedNotice',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchBalances')
            dispatch('torn/fetchTokenBalance', {}, { root: true })
            commit('torn/REMOVE_SIGNATURE', {}, { root: true })
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'Lock',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('lock', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    }
  },
  async lockWithApproval({ getters, rootGetters, commit, rootState, dispatch }, { amount }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']
      const govInstance = getters.govContract({ netId })
      amount = toWei(amount.toString())
      const gas = await govInstance.methods
        .lockWithApproval(amount)
        .estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.lockWithApproval(amount).encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 100000),
          data
        },
        watcherParams: {
          title: 'locking',
          successTitle: 'lockedNotice',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchBalances')
            dispatch('torn/fetchTokenBalance', {}, { root: true })
            dispatch('torn/fetchTokenAllowance', {}, { root: true })
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'Lock',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('lockWithApproval', e.message)
      Toast.open({
        message: this.app.i18n.t('internalError'),
        type: 'is-danger',
        duration: 3000
      })
    }
  },
  async castVote({ getters, rootGetters, commit, rootState, dispatch, state }, { id, support }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']
      const govInstance = getters.govContract({ netId })
      const delegators = [...state.delegators]

      if (toBN(state.lockedBalance).gt(toBN('0'))) {
        delegators.push(ethAccount)
      }

      const gas = await govInstance.methods
        .castDelegatedVote(delegators, id, support)
        .estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.castDelegatedVote(delegators, id, support).encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 30000),
          data
        },
        watcherParams: {
          title: support ? 'votingFor' : 'votingAgainst',
          successTitle: support ? 'votedFor' : 'votedAgainst',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchProposals', { requestId: id })
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'CastVote',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('castVote', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    } finally {
      dispatch('loading/disable', {}, { root: true })
    }
  },
  async executeProposal({ getters, rootGetters, commit, rootState, dispatch }, { id }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']
      const govInstance = getters.govContract({ netId })
      const gas = await govInstance.methods.execute(id).estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.execute(id).encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 100000),
          data
        },
        watcherParams: {
          title: 'executingProposal',
          successTitle: 'proposalExecuted',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchProposals', { requestId: id })
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'ExecuteProposal',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('executeProposal', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    }
  },
  async unlock({ getters, rootGetters, commit, rootState, dispatch }, { amount }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']
      const govInstance = getters.govContract({ netId })
      amount = toWei(amount.toString())
      const gas = await govInstance.methods.unlock(amount).estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.unlock(amount).encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 100000),
          data
        },
        watcherParams: {
          title: 'unlocking',
          successTitle: 'unlocked',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchBalances')
            dispatch('torn/fetchTokenBalance', {}, { root: true })
            commit('torn/REMOVE_SIGNATURE', {}, { root: true })
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'Unlock',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('unlock', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    }
  },
  async delegate({ getters, rootGetters, commit, rootState, dispatch }, { delegatee }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const gas = await govInstance.methods.delegate(delegatee).estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.delegate(delegatee).encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 100000),
          data
        },
        watcherParams: {
          title: 'delegating',
          successTitle: 'delegated',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchDelegatee')
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          storeType: 'govTxs',
          txHash,
          type: 'Delegate',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('delegate', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    }
  },
  async undelegate({ getters, rootGetters, commit, rootState, dispatch }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const gas = await govInstance.methods.undelegate().estimateGas({ from: ethAccount, value: 0 })
      const data = await govInstance.methods.undelegate().encodeABI()

      const callParams = {
        method: 'eth_sendTransaction',
        params: {
          to: govInstance._address,
          gas: numberToHex(gas + 100000),
          data
        },
        watcherParams: {
          title: 'undelegating',
          successTitle: 'undelegated',
          storeType: 'govTxs',
          onSuccess: () => {
            dispatch('fetchDelegatee')
          }
        },
        isAwait: false
      }

      const txHash = await dispatch('metamask/sendTransaction', callParams, { root: true })

      commit(
        'txHashKeeper/SAVE_TX_HASH',
        {
          txHash,
          storeType: 'govTxs',
          type: 'Undelegate',
          netId
        },
        { root: true }
      )
    } catch (e) {
      console.error('undelegate', e.message)
      dispatch(
        'notice/addNoticeWithInterval',
        {
          notice: {
            title: 'internalError',
            type: 'danger'
          },
          interval: 3000
        },
        { root: true }
      )
    }
  },
  async fetchProposals({ rootGetters, getters, commit }, { requestId }) {
    let proposals
    try {
      commit('SAVE_FETCHING_PROPOSALS', true)

      const netId = rootGetters['metamask/netId']
      const aggregatorContract = getters.aggregatorContract
      const govInstance = getters.govContract({ netId })

      if (!govInstance) {
        return
      }

      proposals = await govInstance.getPastEvents('ProposalCreated', {
        fromBlock: 0,
        toBlock: 'latest'
      })
      let title, description, rest
      proposals = proposals.map((e) => {
        try {
          ;({ title, description } = JSON.parse(e.returnValues.description))
        } catch (err) {
          ;[title, ...rest] = e.returnValues.description.split('\n', 2)
          description = rest.join('\n')
        }

        const netId = rootGetters['metamask/netId']
        if (netId === 1) {
          switch (Number(e.returnValues.id)) {
            case 1:
              description = 'See: https://torn.community/t/proposal-1-enable-torn-transfers/38'
              break
            case 10:
              ;({ title, description } = JSON.parse(e.returnValues.description.replaceAll('\n', '')))
              break
            case 11:
              ;({ title, description } = JSON.parse(
                e.returnValues.description.replace('"description"', ',"description"')
              ))
          }
        }

        return {
          id: Number(e.returnValues.id),
          title,
          description,
          endTime: Number(e.returnValues.endTime),
          startTime: Number(e.returnValues.startTime),
          proposer: e.returnValues.proposer,
          target: e.returnValues.target,
          results: {
            for: '0',
            against: '0'
          }
        }
      })
      const statuses = await aggregatorContract.methods.getAllProposals(govInstance._address).call()
      proposals = proposals
        .map((p) => {
          const proposal = statuses[Number(p.id) - 1]

          if (proposal.extended) {
            p.endTime = Number(proposal.endTime)
          }

          p.status = ProposalState[Number(proposal.state)]
          p.results = {
            for: fromWei(proposal.forVotes),
            against: fromWei(proposal.againstVotes)
          }
          return p
        })
        .sort((a, b) => {
          return a.id - b.id
        })
      if (requestId) {
        return proposals[requestId]
      }
    } catch (e) {
      console.error('fetchProposals', e.message)
    } finally {
      commit('SAVE_PROPOSALS', proposals)
      commit('SAVE_FETCHING_PROPOSALS', false)
    }
  },
  async fetchBalances({ getters, rootGetters, commit, rootState }) {
    try {
      commit('SAVE_FETCHING_LOCKED_BALANCE', true)
      const { ethAccount } = rootState.metamask

      if (!ethAccount) {
        return
      }

      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const balance = await govInstance.methods.lockedBalance(ethAccount).call()
      commit('SAVE_LOCKED_BALANCE', { balance })
    } catch (e) {
      console.error('fetchBalances', e.message)
    } finally {
      commit('SAVE_FETCHING_LOCKED_BALANCE', false)
    }
  },
  async fetchedLockedTimestamp({ getters, rootGetters, commit, rootState, dispatch }) {
    try {
      const { ethAccount } = rootState.metamask

      if (!ethAccount) {
        return
      }

      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const timestamp = await govInstance.methods.canWithdrawAfter(ethAccount).call()
      commit('SAVE_LOCKED_TIMESTAMP', { timestamp })
    } catch (e) {
      console.error('fetchedLockedTimestamp', e.message)
    }
  },
  async fetchLatestProposalId({ getters, rootGetters, commit, rootState, state }) {
    try {
      const { ethAccount } = rootState.metamask

      if (!ethAccount) {
        return
      }

      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const id = await govInstance.methods.latestProposalIds(ethAccount).call()
      let status = null
      if (Number(id)) {
        status = await govInstance.methods.state(id).call()
        status = Number(status) > 1 ? null : 'active'
      }
      commit('SAVE_LATEST_PROPOSAL_ID', { id, status })
      console.log('status', state.latestProposalId)
    } catch (e) {
      console.error('fetchLatestProposalId', e.message)
    }
  },
  async fetchDelegatedBalance({ getters, rootGetters, commit, rootState, dispatch }) {
    try {
      commit('SAVE_FETCHING_DELEGATED_BALANCE', true)
      const { ethAccount } = rootState.metamask

      if (!ethAccount) {
        return
      }

      const netId = rootGetters['metamask/netId']

      const aggregatorContract = getters.aggregatorContract
      const govInstance = getters.govContract({ netId })
      let delegatedAccs = await govInstance.getPastEvents('Delegated', {
        filter: {
          to: ethAccount
        },
        fromBlock: 0,
        toBlock: 'latest'
      })
      let undelegatedAccs = await govInstance.getPastEvents('Undelegated', {
        filter: {
          from: ethAccount
        },
        fromBlock: 0,
        toBlock: 'latest'
      })
      delegatedAccs = delegatedAccs.map((acc) => acc.returnValues.account)
      undelegatedAccs = undelegatedAccs.map((acc) => acc.returnValues.account)
      const uniq = delegatedAccs.filter((obj, index, self) => {
        const indexUndelegated = undelegatedAccs.indexOf(obj)
        if (indexUndelegated !== -1) {
          undelegatedAccs.splice(indexUndelegated, 1)
          return false
        }
        return true
      })
      let balances = await aggregatorContract.methods.getGovernanceBalances(govInstance._address, uniq).call()
      balances = balances.reduce((acc, balance, i) => {
        acc = acc.add(toBN(balance))
        return acc
      }, toBN('0'))
      commit('SAVE_DELEGATED_BALANCE', balances.toString(10))
      commit('SAVE_DELEGATORS', uniq)
    } catch (e) {
      console.error('fetchDelegatedBalance', e.message)
    } finally {
      commit('SAVE_FETCHING_DELEGATED_BALANCE', false)
    }
  },
  async fetchDelegatee({ getters, rootGetters, commit, rootState, dispatch }) {
    try {
      const { ethAccount } = rootState.metamask

      if (!ethAccount) {
        return
      }

      const netId = rootGetters['metamask/netId']

      const govInstance = getters.govContract({ netId })
      const currentDelegate = await govInstance.methods.delegatedTo(ethAccount).call()
      console.log('currentDelegate', currentDelegate)
      commit('SAVE_DELEGATEE', { currentDelegate })
    } catch (e) {
      console.error('fetchDelegatee', e.message)
    }
  },
  async fetchReceipt({ getters, rootGetters, commit, rootState, dispatch }, { id }) {
    try {
      const { ethAccount } = rootState.metamask
      const netId = rootGetters['metamask/netId']
      console.log('fetchReceipt', id)
      const govInstance = getters.govContract({ netId })
      const [hasVoted, support, balance] = await govInstance.methods.getReceipt(id, ethAccount).call()
      console.log('fetchReceipt', hasVoted, support, balance)
      commit('SAVE_VOTER_RECEIPT', { hasVoted, support, balance, id })
    } catch (e) {
      console.error('fetchReceipt', e.message)
    }
  },
  async fetchUserData({ getters, rootGetters, commit, rootState, dispatch }) {
    try {
      commit('SAVE_FETCHING_LOCKED_BALANCE', true)
      const { ethAccount } = rootState.metamask

      if (!ethAccount) {
        return
      }

      const netId = rootGetters['metamask/netId']
      const govInstance = getters.govContract({ netId })
      const aggregatorContract = getters.aggregatorContract
      const {
        balance,
        latestProposalId,
        timelock,
        delegatee,
        ...userdata
      } = await aggregatorContract.methods.getUserData(govInstance._address, ethAccount).call()
      commit('SAVE_DELEGATEE', { currentDelegate: delegatee })

      const latestProposalIdState = ProposalState[Number(userdata.latestProposalIdState)]
      commit('SAVE_LATEST_PROPOSAL_ID', { id: Number(latestProposalId), status: latestProposalIdState })
      commit('SAVE_LOCKED_TIMESTAMP', { timestamp: Number(timelock) })
      commit('SAVE_LOCKED_BALANCE', { balance })
    } catch (e) {
      console.error('fetchUserData', e.message)
    } finally {
      commit('SAVE_FETCHING_LOCKED_BALANCE', false)
    }
  },
  async checkActiveProposals({ getters, rootGetters, commit }) {
    if (!getters.isEnabledGovernance) {
      return
    }

    const { 'governance.contract.tornadocash.eth': governanceAddress } = rootGetters['metamask/networkConfig']
    const aggregatorContract = getters.aggregatorContract

    const statuses = await aggregatorContract.methods.getAllProposals(governanceAddress).call()
    let isActive = false
    if (statuses && Array.isArray(statuses)) {
      isActive = statuses.find((status) => Number(status.state) === 1)
    }

    commit('SET_HAS_ACTIVE_PROPOSALS', Boolean(isActive))
  },
  async fetchConstants({ commit, getters, dispatch, rootGetters }) {
    const netId = rootGetters['metamask/netId']
    const govInstance = getters.govContract({ netId })
    const constants = [].concat(govConstants, proposalIntervalConstants)

    const params = constants.map((name) => {
      return {
        target: govInstance._address,
        callData: govInstance.methods[name]().encodeABI()
      }
    })

    const multicallArray = await dispatch('application/aggregateMulticall', { params }, { root: true })

    if (multicallArray) {
      const hexToNumberConverter = (acc, curr, index) => {
        const name = constants[index]
        const value = govConstants.includes(name) ? hexToNumberString(curr) : hexToNumber(curr)

        return { ...acc, [name]: value }
      }

      const result = multicallArray.reduce(hexToNumberConverter, {})

      commit('SAVE_CONSTANTS', result)
    }
  }
}

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
}