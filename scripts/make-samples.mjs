// Generates a handful of original sample images (drawn from SVG, so there are no
// licensing concerns) plus sidecar metadata files, into assets/pixle/samples/.
// They arrive as DRAFTS like any other image: approve + schedule them in /admin.
//
//   npm run samples
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.join(process.cwd(), 'assets', 'pixle', 'samples');
fs.mkdirSync(outDir, { recursive: true });

const samples = [
  {
    file: 'sailboat',
    meta: { answer: 'Sailboat', accepted: ['boat', 'sailing boat', 'yacht', 'sail boat', 'ship'], theme: 'Vehicles', hint: 'Travels without an engine', difficulty: 'easy' },
    svg: `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd9a0"/><stop offset="1" stop-color="#f08a5d"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#s)"/><circle cx="880" cy="300" r="110" fill="#fff3c4"/>
      <rect y="600" width="1200" height="300" fill="#1d6a96"/><path d="M0 640 Q150 610 300 640 T600 640 T900 640 T1200 640 V680 H0Z" fill="#2a86b8"/>
      <rect x="560" y="170" width="16" height="440" fill="#4a2f1b"/><path d="M590 190 L590 560 L880 560Z" fill="#fdfdf5"/><path d="M545 240 L545 560 L330 560Z" fill="#e63946"/>
      <path d="M300 590 H900 L820 690 H380Z" fill="#3b2314"/><rect x="300" y="590" width="600" height="22" fill="#f1faee"/>`,
  },
  {
    file: 'lighthouse',
    meta: { answer: 'Lighthouse', accepted: ['light house', 'beacon'], theme: 'Architecture and landmarks', hint: 'Coastal structure', difficulty: 'medium' },
    svg: `<rect width="1200" height="900" fill="#14213d"/><circle cx="220" cy="170" r="70" fill="#f1f1e6"/>
      <g fill="#fff"><circle cx="420" cy="120" r="5"/><circle cx="980" cy="210" r="5"/><circle cx="1080" cy="90" r="4"/><circle cx="90" cy="380" r="4"/><circle cx="860" cy="70" r="4"/></g>
      <path d="M640 240 L1200 130 V350Z" fill="#fca311" opacity=".55"/>
      <path d="M530 290 H710 L760 780 H480Z" fill="#f8f9fa"/><path d="M521 400 H719 L728 500 H512Z" fill="#d62828"/><path d="M503 600 H737 L746 700 H494Z" fill="#d62828"/>
      <rect x="545" y="200" width="150" height="90" fill="#fca311"/><rect x="520" y="280" width="200" height="22" fill="#22223b"/><path d="M530 200 H710 L620 120Z" fill="#d62828"/>
      <rect x="595" y="690" width="50" height="90" fill="#22223b"/>
      <path d="M0 780 Q300 700 620 770 T1200 760 V900 H0Z" fill="#3a3a44"/><rect y="850" width="1200" height="50" fill="#1b4965"/>`,
  },
  {
    file: 'cactus',
    meta: { answer: 'Cactus', accepted: ['cacti', 'saguaro', 'saguaro cactus', 'desert cactus'], theme: 'Nature', hint: 'Desert plant life', difficulty: 'easy' },
    svg: `<rect width="900" height="1100" fill="#8ecae6"/><circle cx="700" cy="210" r="95" fill="#ffb703"/>
      <path d="M0 820 Q250 740 480 800 T900 780 V1100 H0Z" fill="#e9c46a"/><path d="M0 900 Q300 850 900 910 V1100 H0Z" fill="#d4a24c"/>
      <g fill="#2a9d55"><rect x="390" y="250" width="130" height="640" rx="65"/><rect x="230" y="430" width="90" height="230" rx="45"/><rect x="230" y="580" width="220" height="80" rx="40"/>
      <rect x="590" y="350" width="90" height="250" rx="45"/><rect x="470" y="520" width="210" height="80" rx="40"/></g>
      <g stroke="#1b6e3a" stroke-width="8"><path d="M430 300 V860"/><path d="M480 300 V860"/></g><circle cx="455" cy="240" r="30" fill="#e76f9b"/>`,
  },
  {
    file: 'hot-air-balloon',
    meta: { answer: 'Hot Air Balloon', accepted: ['balloon', 'hot-air balloon', 'air balloon', 'hotair balloon'], theme: 'Vehicles', hint: 'Lighter than air', difficulty: 'medium' },
    svg: `<rect width="900" height="1100" fill="#bde0fe"/>
      <g fill="#fff"><ellipse cx="170" cy="250" rx="130" ry="45"/><ellipse cx="740" cy="520" rx="150" ry="50"/><ellipse cx="230" cy="800" rx="110" ry="38"/></g>
      <path d="M450 120 C200 120 150 380 250 560 L380 760 H520 L650 560 C750 380 700 120 450 120Z" fill="#e63946"/>
      <path d="M450 120 C340 120 310 380 360 560 L410 760 H490 L540 560 C590 380 560 120 450 120Z" fill="#ffd166"/>
      <path d="M450 120 C415 120 405 380 425 560 L440 760 H460 L475 560 C495 380 485 120 450 120Z" fill="#118ab2"/>
      <g stroke="#3d2c1e" stroke-width="7"><path d="M385 760 L405 890"/><path d="M515 760 L495 890"/></g><rect x="390" y="890" width="120" height="95" rx="10" fill="#8d5a2b"/>
      <rect x="390" y="890" width="120" height="20" fill="#5e3b1a"/>`,
  },
  {
    file: 'mushroom',
    meta: { answer: 'Mushroom', accepted: ['toadstool', 'fly agaric', 'fungus', 'mushrooms'], theme: 'Nature', hint: 'Found on the forest floor', difficulty: 'easy' },
    svg: `<rect width="1100" height="900" fill="#264d3b"/>
      <g fill="#1b3a2c"><rect x="80" width="90" height="900"/><rect x="900" width="120" height="900"/><rect x="330" width="60" height="900"/></g>
      <path d="M0 720 Q550 640 1100 720 V900 H0Z" fill="#5b3a21"/>
      <path d="M470 430 H640 Q690 640 660 760 H450 Q420 640 470 430Z" fill="#f4ecd8"/>
      <path d="M210 470 C210 160 890 160 890 470 Q550 540 210 470Z" fill="#d62828"/>
      <g fill="#fdfcf5"><circle cx="400" cy="340" r="42"/><circle cx="580" cy="290" r="50"/><circle cx="730" cy="390" r="36"/><circle cx="300" cy="430" r="26"/><circle cx="500" cy="440" r="24"/><circle cx="810" cy="450" r="20"/></g>
      <g fill="#3f7d4e"><path d="M120 760 l30 -110 l30 110Z"/><path d="M800 780 l30 -130 l30 130Z"/><path d="M880 790 l24 -90 l24 90Z"/></g>`,
  },
  {
    file: 'rocket',
    meta: { answer: 'Rocket', accepted: ['rocket ship', 'rocketship', 'spaceship', 'space ship', 'spacecraft', 'space rocket'], theme: 'Technology', hint: 'Built to leave the planet', difficulty: 'medium' },
    svg: `<rect width="900" height="1100" fill="#0b132b"/>
      <g fill="#fff"><circle cx="120" cy="150" r="5"/><circle cx="760" cy="230" r="6"/><circle cx="660" cy="90" r="4"/><circle cx="210" cy="520" r="4"/><circle cx="800" cy="640" r="5"/><circle cx="90" cy="820" r="5"/><circle cx="320" cy="90" r="3"/></g>
      <circle cx="730" cy="880" r="120" fill="#5bc0be" opacity=".8"/>
      <path d="M370 800 Q450 1060 530 800Z" fill="#ff9f1c"/><path d="M405 800 Q450 960 495 800Z" fill="#ffe066"/>
      <path d="M340 600 L230 820 L360 760Z" fill="#e63946"/><path d="M560 600 L670 820 L540 760Z" fill="#e63946"/>
      <path d="M450 110 C330 260 330 520 350 800 H550 C570 520 570 260 450 110Z" fill="#f1f5f9"/>
      <path d="M450 110 C400 172 372 240 358 310 H542 C528 240 500 172 450 110Z" fill="#e63946"/>
      <circle cx="450" cy="450" r="62" fill="#1c2541"/><circle cx="450" cy="450" r="44" fill="#6fffe9"/><rect x="350" y="700" width="200" height="26" fill="#94a3b8"/>`,
  },
];

for (const sample of samples) {
  const size = sample.svg.match(/<rect width="(\d+)" height="(\d+)"/);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size[1]} ${size[2]}" width="${size[1]}" height="${size[2]}">${sample.svg}</svg>`;
  const file = path.join(outDir, `${sample.file}.png`);
  await sharp(Buffer.from(svg)).png().toFile(file);
  fs.writeFileSync(
    file + '.json',
    JSON.stringify({ ...sample.meta, creator: 'Pixle sample artwork', licence: 'CC0 / public domain', sourceUrl: '' }, null, 2) + '\n',
  );
  console.log('wrote', path.relative(process.cwd(), file));
}
console.log('\nDone. Open /admin to review, approve and schedule them.');
