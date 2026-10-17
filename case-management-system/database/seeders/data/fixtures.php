<?php

use App\Enums\FixtureFile;
use App\Enums\IllustrationMotif;

return [
    'documents' => [
        FixtureFile::SnowClearingQuote->value => [
            'title' => 'Northway Property Management',
            'lines' => [
                'Quote Q-1187: snow clearing for the winter season',
                '',
                'Prepared for: :owner',
                'Property: 61 Brenwick Avenue, Toronto, Ontario',
                'Season: November 15 to April 15',
                '',
                "Seasonal snow clearing contract\t$1,480.00",
                '    Driveway, front walk and side path, cleared at 5 cm or more',
                "Salting of steps and walkways, full season\t$260.00",
                '',
                "Subtotal\t$1,740.00",
                "HST (13%)\t$226.20",
                "Total for the season\t$1,966.20",
                '',
                "Optional: fall eavestrough cleaning\t$220.00",
                '    Front and back eavestroughs and downspouts, plus HST of $28.60',
                '',
                'All amounts are in Canadian dollars.',
                'Quote valid for 30 days. Payment in two instalments on request.',
                'Questions: hello@northwaypm.example',
                '',
                'Sample document generated for the Casefile demo. All names are fictional.',
            ],
        ],
        FixtureFile::FurnaceFilterInvoice->value => [
            'title' => 'Dufferin Plumbing',
            'lines' => [
                'Invoice 2291',
                '',
                'Bill to: :owner',
                'Service address: 61 Brenwick Avenue, unit 3A, Toronto, Ontario',
                'Work: furnace service and filter replacement',
                '',
                "Service call and labour, 1.5 hours\t$135.00",
                "Furnace filter 16x25x1 MERV 8, 2 at $18.00\t$36.00",
                "Flame sensor cleaning and test\t$29.00",
                '',
                "Subtotal\t$200.00",
                "HST (13%)\t$26.00",
                "Total due\t$226.00",
                '',
                'All amounts are in Canadian dollars.',
                'Terms: due within 30 days of the visit.',
                'Payment by e-transfer to service@dufferinplumbing.example.',
                'Technician notes: old filter heavily loaded. Venting checked and clear.',
                '',
                'Sample document generated for the Casefile demo. All names are fictional.',
            ],
        ],
    ],
    'illustrations' => [
        FixtureFile::KitchenSinkLeak->value => [
            'caption' => 'Kitchen sink leak, unit 3A',
            'accent' => '#2f6f9f',
            'motif' => IllustrationMotif::KitchenSink,
        ],
        FixtureFile::ThermostatError->value => [
            'caption' => 'Thermostat error, unit 2B',
            'accent' => '#c0573a',
            'motif' => IllustrationMotif::Thermostat,
        ],
    ],
];
