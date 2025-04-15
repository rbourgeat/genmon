// Map Tile Types
const TILE_PATH = 0;
const TILE_GRASS = 1;
const TILE_OBSTACLE = 2;

// Map Data (Consider moving to a separate map file if it gets large)
const mapData = [
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [2, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 2],
    [2, 0, 2, 0, 1, 2, 2, 1, 0, 2, 0, 2],
    [2, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 2],
    [2, 1, 1, 0, 2, 0, 0, 2, 0, 1, 1, 2],
    [2, 1, 1, 0, 2, 0, 0, 2, 0, 1, 1, 2],
    [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    [2, 0, 2, 1, 1, 2, 2, 1, 1, 2, 0, 2],
    [2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
];
const MAP_WIDTH = mapData[0].length;
const MAP_HEIGHT = mapData.length;

// Game Mechanics
const WILD_ENCOUNTER_CHANCE = 0.15; // 15% chance per step on grass
const HEAL_INTERVAL = 10000; // Heal every 10 seconds
const HEAL_AMOUNT = 1; // Heal 1 HP per interval
const MAX_TEAM_SIZE = 6;
const DUEL_MAX_DISTANCE = 3; // Max distance to initiate a duel

// XP and Money
const INITIAL_MONEY = 500;
const INITIAL_LEVEL = 5; // Starting level for Genmon
const BASE_XP_GAIN = 50; // Base XP for defeating a Genmon
const DUEL_WIN_MONEY = 100; // Money earned for winning a PvP duel


module.exports = {
    TILE_PATH,
    TILE_GRASS,
    TILE_OBSTACLE,
    mapData,
    MAP_WIDTH,
    MAP_HEIGHT,
    WILD_ENCOUNTER_CHANCE,
    HEAL_INTERVAL,
    HEAL_AMOUNT,
    MAX_TEAM_SIZE,
    DUEL_MAX_DISTANCE,
    INITIAL_MONEY,
    INITIAL_LEVEL,
    BASE_XP_GAIN,
    DUEL_WIN_MONEY,
};