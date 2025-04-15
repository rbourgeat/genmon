const wild = require('./wild');
const duel = require('./duel');
const actions = require('./actions');
const end = require('./end');
// No need to import turn or state here, they are used internally by actions/end

module.exports = {
    startWildBattle: wild.startWildBattle,
    handleInitiateDuel: duel.handleInitiateDuel,
    handleRespondDuel: duel.handleRespondDuel,
    requestPlayerAction: actions.requestPlayerAction,
    handlePlayerAction: actions.handlePlayerAction,
    handlePlayerDisconnectBattle: end.handlePlayerDisconnectBattle,
    // No need to export handleBattleEnd, processBattleTurn, etc. as they are internal calls
};