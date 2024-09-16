import { Game } from '@staratlas/sage'
import dayjs from 'dayjs'

import { now } from '../../../dayjs'
import { logger } from '../../../logger'
import { Resource } from '../../../service/wallet'
import { getTokenBalance } from '../basedbot'
import { dock } from '../lib/sage/act/dock'
import { loadCargo } from '../lib/sage/act/load-cargo'
import { move, WarpMode } from '../lib/sage/act/move'
import { undock } from '../lib/sage/act/undock'
import { getHold, unloadCargo } from '../lib/sage/act/unload-cargo'
import { starbaseByCoordinates } from '../lib/sage/state/starbase-by-coordinates'
import { Player } from '../lib/sage/state/user-account'
import { FleetInfo } from '../lib/sage/state/user-fleets'
import { WorldMap } from '../lib/sage/state/world-map'
import { getName } from '../lib/sage/util'
import { Coordinates } from '../lib/util/coordinates'

import { Strategy } from './strategy'

enum MODE {
    BACK,
    FORTH,
}
let mode: MODE = MODE.FORTH

// eslint-disable-next-line complexity
const transition = async (
    fleetInfo: FleetInfo,
    player: Player,
    game: Game,
    config: TransportConfig,
): Promise<void> => {
    const cargoLoad = player.cargoTypes
        .filter((ct) => !ct.data.mint.equals(game.data.mints.food))
        .reduce((acc, cargoType) => {
            const load =
                fleetInfo.cargoLevels.cargo.get(
                    cargoType.data.mint.toBase58(),
                ) ?? 0

            return acc + load
        }, 0)

    const { cargoCapacity } = fleetInfo.cargoStats
    const cargoLevelFuel = fleetInfo.cargoLevels.fuel
    const cargoLevelAmmo = fleetInfo.cargoLevels.ammo
    const hasEnoughFuel =
        cargoLevelFuel >= fleetInfo.cargoStats.fuelCapacity / 10
    const hasEnoughAmmo =
        cargoLevelAmmo >= fleetInfo.cargoStats.ammoCapacity - 100
    const hasCargo = cargoLoad > 0
    const currentStarbase = await starbaseByCoordinates(fleetInfo.location)
    const { fleetName, location } = fleetInfo
    const { homeBase, targetBase, resources, warpMode } = config
    const isAtHomeBase = homeBase.equals(location)
    const isAtTargetBase = targetBase.equals(location)
    const isSameBase = homeBase.equals(targetBase)

    logger.info(
        `${fleetName} is transporting ${config.resources.size} resources from ${config.homeBase} to ${config.targetBase}`,
    )

    switch (fleetInfo.fleetState.type) {
        case 'Idle': {
            logger.info(
                `${fleetName} is idle at ${fleetInfo.fleetState.data.sector} [Starbase: ${currentStarbase ? getName(currentStarbase) : 'N/A'}]`,
            )

            if (!currentStarbase && cargoLevelFuel < 1) {
                logger.warn(
                    `${fleetName} is out of fuel and not at a starbase, need self destruction`,
                )

                return Promise.resolve()
            }
            if (isAtHomeBase) {
                logger.info(`${fleetName} is at home base`)
                if (hasCargo && mode === MODE.BACK) {
                    logger.info(
                        `${fleetName} has ${cargoLoad} cargo, docking to unload`,
                    )

                    return dock(fleetInfo, location, player, game)
                }
                if (!hasEnoughFuel) {
                    logger.info(
                        `${fleetName} doesn't have enough fuel, docking to resupply`,
                    )

                    return dock(fleetInfo, location, player, game)
                }
                if (isSameBase) {
                    logger.warn(
                        `${fleetName} is configured as transport fleet with home and target being the same. Noop.`,
                    )

                    return Promise.resolve()
                }
                logger.info(
                    `${fleetName} is at home base, moving to target base`,
                )

                mode = MODE.FORTH

                return move(fleetInfo, targetBase, player, game, warpMode)
            }

            if (isAtTargetBase && !isSameBase) {
                logger.info(`${fleetName} is at target base`)
                if (hasCargo && mode === MODE.FORTH) {
                    logger.info(
                        `${fleetName} has ${cargoLoad} cargo, docking to unload.`,
                    )

                    return dock(fleetInfo, location, player, game)
                }

                if (!hasEnoughFuel) {
                    logger.info(
                        `${fleetName} doesn't have enough fuel, docking to resupply`,
                    )

                    return dock(fleetInfo, location, player, game)
                }

                logger.info(
                    `${fleetName} has nothing to unload, returning home`,
                )

                mode = MODE.BACK

                return move(fleetInfo, homeBase, player, game, warpMode)
            }

            logger.info(`${fleetName} is at ${location} going home`)

            mode = MODE.BACK

            return move(fleetInfo, homeBase, player, game, warpMode)
        }
        case 'StarbaseLoadingBay': {
            logger.info(
                `${fleetInfo.fleetName} is in the loading bay at ${getName(fleetInfo.fleetState.data.starbase)}`,
            )

            if (isAtHomeBase) {
                if (!hasEnoughFuel) {
                    logger.info(`${fleetInfo.fleetName} is refueling`)

                    return loadCargo(
                        fleetInfo,
                        player,
                        game,
                        game.data.mints.fuel,
                        fleetInfo.cargoStats.fuelCapacity - cargoLevelFuel,
                    )
                }
                if (!hasEnoughAmmo) {
                    logger.info(`${fleetInfo.fleetName} is rearming`)

                    return loadCargo(
                        fleetInfo,
                        player,
                        game,
                        game.data.mints.ammo,
                        fleetInfo.cargoStats.ammoCapacity - cargoLevelAmmo,
                    )
                }

                if (!hasCargo) {
                    logger.info(`Loading ${Array.from(resources).length} cargo`)
                    const cargoResources = Array.from(resources).filter(
                        (resource) =>
                            !resource.equals(game.data.mints.ammo) &&
                            !resource.equals(game.data.mints.fuel),
                    )

                    await Promise.all(
                        cargoResources.map((resource) => {
                            const count = Math.floor(
                                cargoCapacity /
                                    Array.from(cargoResources).length,
                            )

                            logger.info(
                                `Loading ${count} ${resource.toBase58()}`,
                            )

                            return loadCargo(
                                fleetInfo,
                                player,
                                game,
                                resource,
                                count,
                            )
                        }),
                    )
                }
            }

            if (!isAtHomeBase) {
                if (!hasEnoughFuel) {
                    logger.info(`${fleetInfo.fleetName} is refueling`)

                    return loadCargo(
                        fleetInfo,
                        player,
                        game,
                        game.data.mints.fuel,
                        fleetInfo.cargoStats.fuelCapacity / 10,
                    )
                }
                if (hasCargo) {
                    logger.info(
                        `Unloading ${Array.from(resources).length} cargo`,
                    )

                    await Promise.all(
                        Array.from(resources).map(async (resource) => {
                            const fleetCargoPod = getHold(
                                resource,
                                game,
                                fleetInfo,
                            )
                            const amount = await getTokenBalance(
                                fleetCargoPod,
                                resource,
                            )

                            logger.info(
                                `Unloading ${amount} ${resource.toBase58()}`,
                            )

                            return unloadCargo(
                                fleetInfo,
                                player,
                                game,
                                resource,
                                amount,
                            )
                        }),
                    )
                }
            }

            return undock(fleetInfo.fleet, fleetInfo.location, player, game)
        }
        case 'MoveWarp': {
            const { fromSector, toSector, warpFinish } =
                fleetInfo.fleetState.data

            if (warpFinish.isBefore(now())) {
                logger.info(
                    `${fleetInfo.fleetName} has arrived at ${fleetInfo.fleetState.data.toSector}`,
                )
            } else {
                logger.info(
                    `${fleetInfo.fleetName} warping from ${fromSector} to ${toSector}. Arrival in ${dayjs.duration(warpFinish.diff(now())).humanize(false)}. Current Position: ${fleetInfo.location}`,
                )
            }
            break
        }
        case 'MoveSubwarp': {
            const { fromSector, toSector, arrivalTime } =
                fleetInfo.fleetState.data

            if (arrivalTime.isBefore(now())) {
                logger.info(
                    `${fleetInfo.fleetName} has arrived at ${fleetInfo.fleetState.data.toSector}`,
                )
            } else {
                logger.info(
                    `${fleetInfo.fleetName} subwarping from ${fromSector} to ${toSector}. Arrival in ${dayjs.duration(arrivalTime.diff(now())).humanize(false)}. Current Position: ${fleetInfo.location}`,
                )
            }
            break
        }
        case 'MineAsteroid': {
            //TODO: Gather 'Mineable' in order to call `endMine`
            // return endMine(fleetInfo, player, game, config.resource)
            logger.warn(
                `${fleetInfo.fleetName} is currently mining, need to end mine manually.`,
            )

            return Promise.resolve()
        }
        case 'Respawn': {
            const { destructionTime, ETA } = fleetInfo.fleetState.data

            if (ETA.isBefore(now())) {
                logger.info(`${fleetInfo.fleetName} has respawned`)
            } else {
                logger.info(
                    `${fleetInfo.fleetName} respawning at ${fleetInfo.fleetState.data.sector}. ETA: ${dayjs.duration(ETA.diff(now())).humanize(false)}. Destruction time: ${destructionTime}`,
                )
            }
            break
        }
        default:
            logger.info(
                `${fleetInfo.fleetName} is ${fleetInfo.fleetState.type}`,
            )

            return Promise.resolve()
    }
}

export type TransportConfig = {
    map: WorldMap
    homeBase: Coordinates
    targetBase: Coordinates
    resources: Set<Resource>
    warpMode: WarpMode
}

export const transportConfig = (
    config: Partial<TransportConfig> & {
        map: WorldMap
        homeBase: Coordinates
        targetBase: Coordinates
        resources: Set<Resource>
    },
): TransportConfig => ({
    map: config.map,
    homeBase: config.homeBase,
    targetBase: config.targetBase,
    resources: config.resources,
    warpMode: config.warpMode || 'auto',
})

export const transport = (
    map: WorldMap,
    homeBase: Coordinates,
    targetBase: Coordinates,
    resources: Set<Resource>,
): TransportConfig =>
    transportConfig({
        map,
        homeBase,
        targetBase,
        resources,
    })

export const createTransportStrategy = (
    config: TransportConfig,
    player: Player,
    game: Game,
): Strategy => {
    return {
        apply: (fleetInfo: FleetInfo): Promise<void> =>
            transition(fleetInfo, player, game, config),
    }
}
