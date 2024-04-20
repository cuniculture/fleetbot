import { Game, MineItem, Planet, Resource, Starbase } from '@staratlas/sage'

import { logger } from '../../../../../logger'
import { transformSector } from '../../fleet-state/transform/transform-sector'
import { Coordinates } from '../../util/coordinates'

import { getMineItems } from './mine-items'
import { getPlanets } from './planets'
import { getResources } from './resources'
import { getStarbases } from './starbases'

export type PlanetId = string
export type ResourceId = string
export type StarbaseId = string

export type WorldMap = {
    starbases: Array<Starbase>
    planets: Map<StarbaseId, Set<Planet>>
    mineItems: Map<ResourceId, MineItem>
    resources: Map<PlanetId, Set<Resource>>
}

export type Mineable = {
    starbase: Starbase
    planet: Planet
    resource: Resource
    mineItem: MineItem
}

export const planetsByStarbase =
    (planets: Map<StarbaseId, Set<Planet>>, starbase: Starbase): Set<Planet> =>
        planets.get(starbase.key.toBase58()) ?? new Set<Planet>()

export const resourcesByPlanet =
    (resources: Map<PlanetId, Set<Resource>>, planet: Planet): Set<Resource> =>
        resources.get(planet.key.toBase58()) ?? new Set<Resource>()

export const mineItemByResource =
    (mineItems: Map<ResourceId, MineItem>, resource: Resource): MineItem | undefined =>
        mineItems.get(resource.key.toBase58())

export const mineableByCoordinates = (map: WorldMap, coordinates: Coordinates): Set<Mineable> => {
    const starbase = map.starbases.find(s => transformSector(s.data.sector).equals(coordinates))

    if(!starbase) {
        logger.warn(`No starbase found at ${coordinates}`)

        return new Set<Mineable>()
    }
    const planets = planetsByStarbase(map.planets, starbase)
    const minables = new Set<Mineable>()

    planets.forEach((planet) => {
        const resources = resourcesByPlanet(map.resources, planet)

        resources.forEach((resource) => {
            const mineItem = mineItemByResource(map.mineItems, resource)

            if(mineItem) {
                minables.add({
                    starbase,
                    planet,
                    resource,
                    mineItem
                })
            }
        })
    })

    return minables
}

export const getMapContext = async (game: Game): Promise<WorldMap> => {
    const [starbases, pl, mI, res] = await Promise.all([
        getStarbases(game),
        getPlanets(game),
        getMineItems(game),
        getResources(game)
    ])

    const planets = new Map<StarbaseId, Set<Planet>>()
    const resources = new Map<PlanetId, Set<Resource>>()
    const mineItems = new Map<ResourceId, MineItem>()

    starbases.forEach((s) => {
        const location = transformSector(s.data.sector)
        const planetSet = planets.get(s.key.toBase58()) ?? new Set<Planet>()

        pl.filter(p => transformSector(p.data.sector).equals(location)).forEach((p) => {
            planetSet.add(p)
        })

        planets.set(s.key.toBase58(), planetSet)
    })

    res.forEach((r) => {
        const resourceSet = resources.get(r.data.location.toBase58()) ?? new Set<Resource>()

        mineItems.set(r.key.toBase58(), mI.find(m => m.key.equals(r.data.mineItem))!)

        resourceSet.add(r)
        resources.set(r.data.location.toBase58(), resourceSet)
    })

    return {
        starbases,
        planets,
        mineItems,
        resources
    }
}
