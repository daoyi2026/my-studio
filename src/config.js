// Public release v1: the user-accepted R13 model is the production default.
export const MODEL_URL = "./public/model/myroom-studio-v1.glb?rev=6698b7fb";

export const CONTENT = {
  imac: "https://rendaoyi.framer.ai/",
  macbook: "./public/content/kinetic-life-os/index.html",
  phone: "https://bloom-blossom-garden.lovable.app",
  galaxy: "https://daoyi2026.github.io/Moonrise/",
};

export const PHOTO_BINDINGS = [
  ...Array.from({ length: 14 }, (_, i) => ({
    object: `GEO-v57-WallDisplay_board_photo_${String(i + 1).padStart(2, "0")}`,
    material: new RegExp(`board_photo_${String(i + 1).padStart(2, "0")}$`, "i"),
    url: `./public/assets/photos/red-${String(i + 1).padStart(2, "0")}.jpg`,
  })),
  { object: "GEO-v57-WallDisplay_top_fox_art", material: /top_fox_art$/i, url: "./public/assets/photos/green-01.jpg" },
  { object: "GEO-v57-WallDisplay_top_bird_upper", material: /top_bird_upper$/i, url: "./public/assets/photos/green-02.jpg", fit: "contain", inset: .94 },
  { object: "GEO-v57-WallDisplay_top_bird_lower", material: /top_bird_lower$/i, url: "./public/assets/photos/green-03.jpg" },
  { object: "GEO-v57-WallDisplay_top_ocean_poster", material: /top_ocean_poster$/i, url: "./public/assets/photos/green-04.jpg" },
  { object: "GEO-v57-WallDisplay_board_center_portrait", material: /board_center_portrait$/i, url: "./public/assets/photos/green-05.jpg" },
  { object: "GEO-v57-WallDisplay_board_dancer_upper", material: /board_dancer_upper$/i, url: "./public/assets/photos/green-06.jpg" },
  { object: "GEO-v57-WallDisplay_board_dancer_lower", material: /board_dancer_lower$/i, url: "./public/assets/photos/green-07.jpg" },
];

export const REGION_PATTERNS = {
  desk: [/^ASSET_Desk_Anchor$/i, /iMac/i, /MacBook/i, /WallDisplay/i, /BellLamp/i, /phone/i, /Typewriter/i, /Notebook/i, /PaperStack/i, /ClayCup/i],
  drawing: [/drawing-desk/i, /DraftingBoard/i, /Window/i, /telescope/i],
  shelf: [/Shelf/i, /Books-Layer/i, /Trophy/i, /Camera-Leica/i],
};

export const CAMERA = {
  globalFov: 13.5,
  localFov: 31,
  interactionFov: 37,
  globalFill: 0.42,
  localFill: 0.76,
  interactionFill: 0.88,
  zoomSpeed: 2.15,
  horizontalLimit: 45,
  globalUpwardLimit: 45,
  globalDownwardLimit: 15,
};
