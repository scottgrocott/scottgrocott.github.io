// terrain/terrainBounds.js — compute terrain bounding box

export function computeTerrainBounds(terrainCfg, heightGrid, gridRows, gridCols) {
  const size = terrainCfg.size || 700;
  const half = size / 2;
  const heightScale = terrainCfg.heightScale || 80;

  let minY = 0, maxY = 0;
  if (heightGrid) {
    for (let i = 0; i < heightGrid.length; i++) {
      if (heightGrid[i] < minY) minY = heightGrid[i];
      if (heightGrid[i] > maxY) maxY = heightGrid[i];
    }
  } else {
    maxY = heightScale;
  }

  return {
    minX: -half, maxX: half,
    minZ: -half, maxZ: half,
    minY, maxY,
    size,
  };
}
