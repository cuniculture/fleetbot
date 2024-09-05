import { PublicKey } from '@solana/web3.js'
import { InstructionReturn } from '@staratlas/data-source'
import { Fleet, Game } from '@staratlas/sage'

import { StarAtlasPrograms } from '../../programs'
import { Coordinates } from '../../util/coordinates'
import { Player } from '../state/user-account'
import { FleetInfo } from '../state/user-fleets'

export const warpIx = (
    fleetInfo: FleetInfo,
    coordinates: Coordinates,
    fuelTokenAccount: PublicKey,
    player: Player,
    game: Game,
    programs: StarAtlasPrograms,
): InstructionReturn =>
    Fleet.warpToCoordinate(
        programs.sage,
        player.signer,
        player.profile.key,
        player.profileFaction.key,
        fleetInfo.fleet.key,
        fleetInfo.fleet.data.fuelTank,
        player.fuelCargoType.key,
        game.data.cargo.statsDefinition,
        fuelTokenAccount,
        game.data.mints.fuel,
        game.data.gameState,
        game.key,
        programs.cargo,
        {
            toSector: coordinates.toArray(),
            keyIndex: player.keyIndex,
        },
    )
