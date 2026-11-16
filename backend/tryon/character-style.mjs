// Photographic digital double: preserve the photographed person, not an animation style.
export const CHARACTER_APPEARANCE = 'photographic-v1';
export const SCENES = Object.freeze({
  studio: 'A real portrait photography studio with a neutral light-gray seamless backdrop, large softbox illumination, natural white balance and physically plausible contact shadows.',
  city: 'A softly defocused city street in warm daylight. Keep the single subject prominent. No other people or props.',
  poster: 'A quiet charcoal studio backdrop with soft rim light. No text or props.',
});
export function characterPrompt(scene, { face = false, view = null } = {}) {
  if (!Object.hasOwn(SCENES, scene)) return null;
  if (view !== null && (!Number.isInteger(view) || view < 1 || view > 15)) return null;
  const outfitIndex = face ? 3 : 2, anchorIndex = outfitIndex + 1;
  return [
    'Produce ONE photorealistic live-action portrait photograph of the SAME real person in the source photographs. This is an identity-preserving photographic edit for a digital double, not character design. The result must look like a real camera photograph, not an illustration or a 3D render.',
    'Image 1 is the original photograph and authoritative source of identity and body proportions. Preserve the exact face outline, jaw width, cheek volume, eye size and spacing, eyelids, eyebrows, nose bridge and tip, mouth width, lip shape, ears, skin tone, apparent age, hairline, hair parting and hair volume. Preserve glasses including thin/thick frame, lens shape and bridge. Do not beautify or redesign the person.',
    face ? 'Image 2 is an additional real close-up of the SAME person. Match its fine facial features, eyelids, natural skin texture, glasses and hair details while preserving the identity and build in image 1. Do not copy its clothing, accessories not present in image 1, or framing.' : '',
    `Image ${outfitIndex} is the try-on photograph. Preserve this exact outfit: the entire visible combination of top, trousers or skirt, shoes if visible, colors, neckline, sleeve and hem lengths, fabric pattern, layers and accessories. Do not invent jeans, change the trousers color, or substitute clothing from the close-up portrait. Use this image for clothing only; if its face differs from image 1, image 1 wins.`,
    'Preserve natural human proportions and the person’s apparent age. Use photographic skin with fine pores and subtle natural tonal variation, realistic eyelids and iris size, individual fine hair strands, real eyeglass reflections, fabric weave, seams and gravity-driven folds. Use restrained photographic contrast and natural lens perspective. Keep the original facial asymmetry, expression, hair parting, hair volume and body build. No beauty filter, skin smoothing, airbrushing or invented facial detail.',
    'Exclude cartoon, anime, animation-film styling, stylized 3D, CGI, game-avatar rendering, plastic or waxy skin, toy-like hair clumps, enlarged head, oversized eyes, inflated ears, bulbous red nose, invented thick eyebrows, caricature, age change or body slimming. Do not turn the person into a different generic model.',
    view === null
      ? 'Create the FRONT photographic reference: camera at eye level, head and torso square to camera, natural neutral expression and relaxed arms alongside the torso. Preserve the original body build and head-to-body ratio. Show the same visible body coverage as the try-on photograph, with generous margin above the head and below the visible body. Do not invent feet or shoes when they are outside the source frame.'
      : `Image ${anchorIndex} is the approved FRONT photographic reference. Lock this real person’s identity, clothing, body scale, framing and photographic appearance. Photograph this SAME person with the head and torso turned together; do not just rotate the head. Camera stays level, same distance, no tilt or foreshortening. Render orientation ${view * 22.5} degrees from front towards the SUBJECT'S LEFT side (0=front, 90=left profile with nose pointing to the right edge of the picture, 180=back with no face visible, 270=right profile with nose pointing to the left edge). At ${view * 22.5} degrees show only the anatomically visible features. Do not mirror an earlier image. Keep hair parting, asymmetrical clothing and glasses consistent. Infer unseen surfaces conservatively without adding logos, tattoos or accessories. Match the approved reference's vertical crop and subject scale. Preserve real skin and fabric texture at every angle; do not stylize the side or rear views.`,
    view === null ? SCENES[scene] : SCENES.studio,
    'Single centered real person only, with the appearance of an unretouched professional photograph. No collage, panels, labels, text, watermark, mascot or additional people. Plausible hands and anatomy. Minimal perspective distortion.',
  ].filter(Boolean).join(' ');
}
