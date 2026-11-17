# Prompts del arte de los mapas

Las seis imágenes pintadas de los mapas se generaron para este proyecto con una herramienta de
generación de imágenes. Cada una es una imagen original, opaca, de 1536×1024. Aquí están los
prompts completos para que cualquiera pueda conocer su origen o crear variantes.

Los maestros PNG viven en `art/source/` y las versiones WebP que sirve el juego en `public/art/`
(`npm run art:optimize` las regenera). No se incorporaron recursos de Team17, de la serie Worms
ni de otros juegos. Las licencias y el resto de los recursos están en [ASSETS](ASSETS.md).

## Lomas de bronce

### Suelo · `art/source/hills-earth.png`

Use case: stylized-concept. Production asset for an original colorful 2D side-view artillery game called Lombrices de guardia. Create one opaque landscape 1536x1024 hand-painted soil cross-section texture, filling the entire image edge to edge. Front-facing orthographic cut face of earthy bronze-brown soil, layered reddish clay and warm umber, subtle undulating sediment strata, small embedded angular stones, occasional pale winding roots, a few larger rock clusters. Painterly gouache cartoon game art with broad deliberate brush shapes, softly highlighted facets and soft local shadows, medium low contrast and no photographic noise. Small details at varied scales, uneven natural spacing. Consistent diffuse warm light from upper left. The entire image is underground soil material, no sky, no horizon, no grass, no surface edge, no platforms, no holes, no characters, no text, no logos, no border or UI. This is a material texture to clip against an existing destructible terrain mask; it must read equally well anywhere in the image and not contain its own terrain silhouette. Cohesive muted ochre, clay, bronze and brown colors complement warm peach cartoon worms with dark outlines. Avoid high contrast or gritty photorealism.

### Fondo · `art/source/hills-backdrop.png`

Use case: stylized-concept. Production painted backdrop for an original colorful 2D side-view artillery game. Create one opaque wide landscape 1536x1024 panoramic background: a pale warm turquoise sky with a few soft cream clouds, sunlit distant rolling bronze-olive hills, bluish hazy mountains, a quiet winding valley, loose patches of distant trees. Composition: upper 55 percent mostly open airy sky, horizon at 55 percent, layered gently rolling hills occupy lower 45 percent and continue to every bottom and side edge. This is distant scenery behind a separate playable foreground; include no foreground close-up objects, no vertical cliffs, no playable platforms, no soil cross sections. Original charming gouache cartoon illustration with broad hand-painted shapes, subtle paperless brush texture, atmospheric depth, soft warm afternoon light from upper left. Restrained contrast and desaturated greens/blue greens behind highly readable characters. Landscape should feel expansive across full width, not framed. No text, characters, weapons, buildings, UI, borders, watermarks or brand assets.

## Gruta luminosa

### Roca · `art/source/cavern-rock.png`

Use case: stylized-concept. Asset type: original painted rock material bitmap for destructible 2D side-view artillery game, the playable solid interior of a luminous grotto. Create a full-bleed opaque 1536x1024 texture of dense fractured slate and layered mineral rock, slate blue and dusty lavender with deep indigo seams, restrained turquoise mineral veins and a few small embedded cyan/violet crystal facets. The entire frame must be solid rock material, no sky, no open caverns, no holes, no silhouette, no grass, no ground edge, no horizon, no borders, no characters. Flat orthographic side cross-section, painterly gouache illustration, readable broad irregular rock planes and restrained fine grain, craftsmanship comparable to polished hand-painted 2D games. Moderate contrast, luminous mineral accents only in small areas, never bright white or neon. Consistent upper-left soft light, medium scale details that remain legible after masking and at game zoom. Vary mineral sizes, avoid repeated patterns or geometric tiling. No text, logos or watermark. Entire canvas filled with cohesive rocky material.

### Fondo · `art/source/cavern-backdrop.png`

Use case: stylized-concept. Asset type: original atmospheric panorama background bitmap for a 2D side-view luminous grotto game, landscape 1536x1024, opaque. Paint an immense subterranean chamber receding through several layers of haze. A dark indigo/slate rocky vaulted ceiling with delicate stalactites, distant massive pillars, suspended mineral formations and restrained clusters of cyan and lavender crystals. Central middle band spacious and softly lit by cool turquoise mist, darker edges; distant water reflections low in the frame, no sharp foreground platforms. Beautiful hand-painted gouache illustration with visible broad brushwork and subtle texture, rich shape variety, calm low contrast at distance, magical natural geology. This is non-collidable distant scenery; preserve legibility for characters and foreground terrain. Not a level layout, not a cutaway, no floating playable platforms, no central bright focal object, no sky, no characters, no UI, no text, no logos, no watermark. Distinct cool cavern identity with depth, sparse bioluminescent glow, no oversaturated neon.

## Archipiélago coral

### Suelo · `art/source/islands-earth.png`

Use case: stylized-concept. Asset type: original painted interior soil/rock material bitmap for a destructible tropical coral-island 2D side-view game. Full-bleed opaque landscape1536x1024. The whole frame is a continuous orthographic cross section material: warm pale ochre coral limestone, sandy sediment with irregular strata, rounded porous sun-bleached stone, embedded small shell fragments and subtle fossil coral patterns, peach and muted terracotta undertones at depth. Polished painterly gouache game illustration, broad readable material planes, occasional detailed shells, sparse organic mineral veins and weathered pores, restrained grain and varied rock sizes. Low-to-moderate contrast, soft top-left lighting, material must read clearly behind small animated characters. No sky, sea, water, horizon, sand surface line, grass, live plants or palm trees, no holes, no silhouette or borders. No characters, text, logos or watermark. Do not create beach scenery: every pixel must contain solid continuous geological material ready to be clipped by the game's exact island masks.

### Fondo · `art/source/islands-backdrop.png`

Use case: stylized-concept. Asset type: original tropical archipelago distant panorama background bitmap for a 2D side-view game, opaque landscape1536x1024. A luminous turquoise coastal sky fills the upper 55 percent with spacious warm cream cumulus clouds and soft sunlight from upper left. In the lower portion a calm aquamarine sea and several distant irregular tropical islets at different depths, washed blue-green limestone cliffs, sparse tiny palm silhouettes, misty horizon, warm peach sand highlights, gentle cloud reflections. Polished hand-painted gouache illustration with subtle brush texture and atmospheric perspective, broad elegant shapes, warm vacation mood. Background scenery only: keep islands far away, edges low contrast and no large near foreground island or platform; game characters and destructible terrain will sit in front. No UI, no text, no logos, no watermark, no characters, no boats or buildings. Original art cohesive with a colorful handmade 2D artillery game, richly painted but uncluttered.
