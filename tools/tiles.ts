// 地图工具和美术工具共用的尺度约定。地面材质见 art-ground.ts。
import { SPECIES, treeFrame } from '../shared/flora.ts';

/** 建筑的像素尺度（1 m = 8 px）：一层约 3.6 m，底座 0.5 m，女儿墙 0.4 m，右侧投影 1.5 m */
export const BUILDING = { storey: 30, plinth: 4, parapet: 3 };

/** 夏季树贴图目录，地图和美术共用。 */
export const TREES = SPECIES.flatMap((t) => t.sizes.flatMap((r) => Array.from({ length: t.variants }, (_, v) => treeFrame(t.id, r, v, 'summer'))));
