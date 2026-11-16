// Identity comes from the visitor's photos, never an unrelated animation poster.
export const SCENES = Object.freeze({
  studio: 'Plain warm ivory studio backdrop, even neutral lighting and a subtle grounding shadow.',
  city: 'A softly defocused city street in warm daylight. Keep the single subject prominent. No other people or props.',
  poster: 'A quiet charcoal studio backdrop with soft rim light. No text or props.',
});
export function characterPrompt(scene, { face = false, view = null } = {}) {
  if (!Object.hasOwn(SCENES, scene)) return null;
  if (view !== null && (!Number.isInteger(view) || view < 1 || view > 15)) return null;
  const outfitIndex = face ? 3 : 2, anchorIndex = outfitIndex + 1;
  return [
    'Create ONE identity-faithful, lightly stylized 3D character image of this exact real person. Recognizable likeness has priority over animation aesthetics.',
    'Image 1 is the original photograph and authoritative source of identity and body proportions. Preserve the exact face outline, jaw width, cheek volume, eye size and spacing, eyelids, eyebrows, nose bridge and tip, mouth width, lip shape, ears, skin tone, apparent age, hairline, hair parting and hair volume. Preserve glasses including thin/thick frame, lens shape and bridge. Do not beautify or redesign the person.',
    face ? 'Image 2 is an additional close-up of the SAME person; use its visible facial details to reinforce likeness, never its clothing.' : '',
    `Image ${outfitIndex} is the try-on image. Preserve this exact outfit: color, neckline, sleeve and hem lengths, fabric pattern, layers and visible accessories. Use this image for clothing only; if its face differs from image 1, image 1 wins.`,
    'Render natural human facial proportions with restrained 3D shading and fine fabric texture. NO oversized eyes, inflated ears, round red nose, thick invented eyebrows, cartoon grin, quiff, swept-up hair, chibi head, caricature, age change or body slimming. Keep the source hair parting and glasses. Do not replace the person with a generic cartoon man or woman.',
    view === null
      ? 'Create the FRONT reference view: camera at eye level, head and torso square to camera, neutral expression and relaxed arms alongside the torso. Preserve the original body build and head-to-body ratio. Show the same visible body coverage as the try-on image, with generous margin above the head and below the visible body. Do not invent feet or shoes when they are outside the source frame.'
      : `Image ${anchorIndex} is the approved FRONT character. Lock its character design, clothing, body scale, framing, rendering style and identity. Rotate this SAME character as a rigid whole around the vertical axis; do not just rotate the head. Camera stays level, same distance, no tilt or foreshortening. Render orientation ${view * 22.5} degrees from front towards the SUBJECT'S LEFT side (0=front, 90=left profile with nose pointing to the right edge of the picture, 180=back with no face visible, 270=right profile with nose pointing to the left edge). At ${view * 22.5} degrees show only the anatomically visible features. Do not mirror an earlier image. Keep hair parting, asymmetrical clothing and glasses consistent. Infer unseen surfaces conservatively without adding logos, tattoos or accessories. Match the approved reference's vertical crop and subject scale.`,
    view === null ? SCENES[scene] : 'Plain warm ivory studio background with soft even neutral lighting.',
    'Single centered character only. No collage, panels, labels, text, watermark, mascot or additional people. Plausible hands and anatomy. Minimal perspective distortion.',
  ].filter(Boolean).join(' ');
}
