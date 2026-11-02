// 地图工具和美术工具共用的尺度约定。地面材质见 art-ground.ts。

/** 建筑的像素尺度（1 m = 8 px）：一层约 3.6 m，底座 0.5 m，女儿墙 0.4 m，右侧投影 1.5 m */
export const BUILDING = { storey: 30, plinth: 4, parapet: 3, shadow: 12 };

/** 林地里的树：名字里的数字是树冠半径（分米），美术和地图都按这个名单 */
export const TREES = ['tree-25', 'tree-30', 'tree-35', 'tree-40', 'pine-20', 'pine-25', 'pine-30'];
