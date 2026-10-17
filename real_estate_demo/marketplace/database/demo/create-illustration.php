<?php

// Original geometric demo illustration. Standalone GD script; no application or database boot.
$image = imagecreatetruecolor(1200, 800);
$colors = [];
foreach (['wall' => [235, 239, 237], 'tile' => [250, 248, 240], 'grout' => [220, 226, 224],
    'counter' => [210, 197, 174], 'cabinet' => [141, 164, 151], 'edge' => [109, 133, 121],
    'sink' => [224, 231, 233], 'basin' => [172, 190, 197], 'metal' => [111, 137, 148],
    'light' => [224, 233, 233], 'leaf' => [95, 132, 101], 'pot' => [201, 150, 117], 'text' => [67, 85, 83]] as $name => $rgb) {
    $colors[$name] = imagecolorallocate($image, ...$rgb);
}
imagefill($image, 0, 0, $colors['wall']);
imagefilledrectangle($image, 0, 210, 1200, 490, $colors['tile']);
for ($x = 0; $x < 1200; $x += 150) {
    imageline($image, $x, 210, $x, 490, $colors['grout']);
}
for ($y = 210; $y <= 490; $y += 70) {
    imageline($image, 0, $y, 1200, $y, $colors['grout']);
}
imagefilledrectangle($image, 0, 510, 1200, 800, $colors['cabinet']);
imagefilledrectangle($image, 0, 490, 1200, 530, $colors['counter']);
foreach ([0, 400, 800, 1199] as $x) {
    imageline($image, $x, 530, $x, 800, $colors['edge']);
}
imagefilledellipse($image, 620, 505, 570, 125, $colors['sink']);
imagefilledellipse($image, 620, 506, 480, 85, $colors['basin']);
imagesetthickness($image, 25);
imagearc($image, 635, 360, 150, 145, 180, 360, $colors['metal']);
imageline($image, 560, 360, 560, 483, $colors['metal']);
imageline($image, 710, 360, 710, 385, $colors['metal']);
imagefilledellipse($image, 560, 483, 55, 16, $colors['metal']);
imagesetthickness($image, 5);
imageline($image, 555, 365, 555, 470, $colors['light']);
imagefilledellipse($image, 711, 419, 10, 18, $colors['basin']);
imagefilledpolygon($image, [950, 480, 1035, 480, 1022, 550, 963, 550], $colors['pot']);
imagesetthickness($image, 6);
imageline($image, 993, 483, 993, 355, $colors['leaf']);
foreach ([[971, 420], [1010, 393], [970, 365]] as [$x, $y]) {
    imagefilledellipse($image, $x, $y, 50, 23, $colors['leaf']);
}
imagestring($image, 5, 40, 44, 'HAVEN / A LITTLE HOME CARE', $colors['text']);
imagestring($image, 3, 40, 744, 'Original demo illustration - fictional kitchen', $colors['text']);
imagepng($image, __DIR__.'/request-kitchen.png');
