// A first-party THE PIT reference guides rendering only, never the visitor's identity or outfit.
export const STYLE_REFERENCE = 'https://the-pit.site/assets/thumb-find-your-color.webp';
export const SCENES = Object.freeze({
  studio: 'A refined warm ivory studio backdrop, soft golden rim light and a subtle grounding shadow. Keep the original pose and crop. Let the face and outfit be the focus.',
  city: 'A softly defocused colorful European-inspired city street at golden hour, with the warm amber glow and cheerful atmosphere of the style reference. Keep the subject prominent and the original pose and crop.',
  poster: 'A cinematic character portrait with a deep charcoal-to-amber background and a restrained swirl of golden particles behind the subject. Keep the original pose and crop. No props in hands.',
});
export function characterPrompt(scene) {
  if (!Object.hasOwn(SCENES, scene)) return null;
  return [
    'Create one polished THE PIT animated character still, using the supplied images in this exact role order.',
    'Image 1 is the person already wearing the chosen garment. Preserve this exact outfit: garment type, color, neckline, sleeves, hem, fabric pattern, layers and visible accessories. Do not replace the outfit with clothing from any other image.',
    'Image 2 is the original photograph of the same person. Preserve their recognizable facial structure, apparent age, skin tone, hairstyle, hair color, expression and body build. Use it only to recover identity details; ignore its clothing.',
    'Image 3 is the THE PIT visual style reference ONLY. Use its dimensional stylized animation, expressive but proportionate eyes, sculpted soft facial planes, detailed hair strands, tactile fabrics, warm cinematic lighting, gentle bloom and rich colors.',
    'Do not copy any reference character, face, red outfit, mascot, logo, lettering, video duration badge or composition from image 3. Do not turn the person into the female reference character. Preserve the person’s own presentation and silhouette.',
    'Retain the same visible body coverage as image 1. Do not slim, enlarge, undress or change the person’s body. Maintain plausible anatomy, hands and fingers. No invented text, branding or watermark. This is a single still image, not a collage or comparison.',
    SCENES[scene],
  ].join(' ');
}
