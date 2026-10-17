<?php

use App\Enums\FixtureFile;

return [
    'deliveries' => [
        [
            'from' => 'Marcus Leblanc <marcus.leblanc@mail.example>',
            'subject' => 'Bathroom fan rattling, unit 3A',
            'thread_id' => 'thread-script-01',
            'body_text' => <<<'TEXT'
                Hi Dana,

                The bathroom fan in 3A has started rattling loudly whenever it's on. It sounds like something is loose inside the housing, and it seems to be pulling less air than it used to. The mirror stays fogged long after a shower now. It's not urgent, but I wanted to flag it before it gives out completely.

                Thanks,
                Marcus
                TEXT,
            'attachments' => [],
        ],
        [
            'from' => 'Priya Nair <priya.nair@mail.example>',
            'subject' => 'Re: Boiler not firing, unit 2B',
            'thread_id' => 'thread-0016',
            'body_text' => <<<'TEXT'
                Hi Dana,

                A quick update on the heat. Marcus says 3A is warm, but his unit has its own furnace, so it's just the boiler side of the building. I went down to the basement and the boiler's display is blinking, and there's no sound from the pump. I didn't touch anything down there. Please let me know when someone is coming so I can be home.

                Thanks,
                Priya
                TEXT,
            'attachments' => [],
        ],
        [
            'from' => 'Lakeshore Utilities <news@lakeshoreutilities.example>',
            'subject' => 'Get your home ready for the heating season',
            'thread_id' => 'thread-news-02',
            'body_text' => <<<'TEXT'
                Hello Dana,

                As the weather turns colder, a few small steps can keep your heating bills down. Replace or clean your furnace filter every three months, and bleed your radiators if they're warm at the bottom but cool at the top. Weatherstripping around doors and windows can noticeably cut drafts. Sign in to your online account to compare this month's usage with the same month last year.

                The Lakeshore Utilities team
                TEXT,
            'attachments' => [],
        ],
        [
            'from' => 'Northway Property Management <hello@northwaypm.example>',
            'subject' => 'Eavestrough cleaning estimate',
            'thread_id' => 'thread-script-04',
            'body_text' => <<<'TEXT'
                Hi Dana,

                You asked about the eavestroughs when we spoke last week, so I've attached our seasonal quote again with the fall cleaning line included. The cleaning is $220 plus HST and covers the front and back eavestroughs, the downspouts and a quick check of the flashing. Our crew can usually fit it in within a week of the leaves coming down. Just reply to this email if you'd like us to add it to your account.

                Best regards,
                Alicia Moreau
                Northway Property Management
                TEXT,
            'attachments' => [FixtureFile::SnowClearingQuote],
        ],
        [
            'from' => 'Dufferin Plumbing <service@dufferinplumbing.example>',
            'subject' => 'Re: Invoice 2291: furnace filter and service',
            'thread_id' => 'thread-0011',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks again for the quick payment on invoice 2291. While writing up the job, our technician flagged that the condensate line on the 3A furnace is cracked and dripping into the drain pan. It isn't an emergency, but it should be replaced before the coldest weeks. We can do it for $95 plus HST, and we could combine it with another visit to save you a second service call. Let me know if you'd like us to go ahead.

                Thanks,
                Rob Kowalczyk
                Service coordinator, Dufferin Plumbing
                TEXT,
            'attachments' => [],
        ],
        [
            'from' => 'Dufferin Plumbing <service@dufferinplumbing.example>',
            'subject' => 'Hot water tank inspection',
            'thread_id' => 'thread-script-06',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Our records show the hot water tank in the basement of 61 Brenwick Avenue is now twelve years old. Tanks that age often start to corrode inside before they show any leaks. We recommend an inspection of the anode rod, the relief valve and the venting, which costs $140 plus HST. If the tank needs replacing, we'll give you a written quote before doing any work.

                Thanks,
                Rob Kowalczyk
                Service coordinator, Dufferin Plumbing
                TEXT,
            'attachments' => [],
        ],
        [
            'from' => 'Marcus Leblanc <marcus.leblanc@mail.example>',
            'subject' => 'Re: Kitchen sink leaking, unit 3A',
            'thread_id' => 'thread-0014',
            'body_text' => <<<'TEXT'
                Hi Dana,

                The plumber came by and replaced the drain fitting, and the dishwasher runs without leaking now. There's still a slow drip from the cold water shut-off under the sink, though, maybe one drop a minute. The cabinet floor is also swollen where the water sat. Could someone take another look when they're next in the building?

                Thanks,
                Marcus
                TEXT,
            'attachments' => [],
        ],
        [
            'from' => 'Priya Nair <priya.nair@mail.example>',
            'subject' => 'Front door closer',
            'thread_id' => 'thread-script-08',
            'body_text' => <<<'TEXT'
                Hi Dana,

                The closer on the front door of the building has stopped working properly. The door now slams shut so hard that it rattles the mail slot, and twice this week it didn't latch at all. I'm a bit worried about the door being left open overnight. Would you be able to get it adjusted or replaced?

                Thanks,
                Priya
                TEXT,
            'attachments' => [],
        ],
    ],
    'replies' => [
        [
            'thread_id' => 'thread-0009',
            'from' => 'Marcus Leblanc <marcus.leblanc@mail.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for keeping me posted on the dryer. The drying rack has been working fine in the meantime. If the part arrives on a weekday, I'm usually up by 2 in the afternoon and happy to help pull the dryer out from the wall.

                Marcus
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0010',
            'from' => 'Priya Nair <priya.nair@mail.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for following up on the caulking. Weekends are easiest for me, especially in the morning. If the tub needs to stay dry beforehand, just let me know and I'll shower at the gym the night before.

                Priya
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0011',
            'from' => 'Dufferin Plumbing <service@dufferinplumbing.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for the go-ahead on the condensate line. Our technician has the part on his truck and will replace it on his next visit to the building, which should be within the week. The repair is $95 plus HST, and we'll send the invoice once the job is done. If anything else needs a look while he's there, just let me know.

                Thanks,
                Rob Kowalczyk
                Service coordinator, Dufferin Plumbing
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0012',
            'from' => 'Northway Property Management <hello@northwaypm.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for getting back to us. Just a reminder that the second applicant has another unit on hold until the end of the week, so a decision soon would help us keep her. As soon as you confirm, we'll prepare the lease and send it for signature the same day.

                Best regards,
                Alicia Moreau
                Northway Property Management
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0013',
            'from' => 'Dufferin Plumbing <service@dufferinplumbing.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Following up on the shut-off valve quote. We have two morning openings next week, and the water would be off from about 9 to 11. If you pick a day, we can send you a short notice to post for the tenants.

                Thanks,
                Rob Kowalczyk
                Service coordinator, Dufferin Plumbing
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0014',
            'from' => 'Marcus Leblanc <marcus.leblanc@mail.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for staying on top of this. I've kept the bucket under the sink and left the cabinet doors open so the floor can dry out. Weekday afternoons are easiest for me, and anyone is welcome to use the lockbox key if I'm asleep.

                Marcus
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0015',
            'from' => 'Northway Property Management <hello@northwaypm.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for looking over the quote. If it helps, we can split the seasonal contract into two payments, half now and half at the midpoint of the season. Once you confirm, our crew lead will walk the property to mark the walkways and the new parking spots before the first snowfall.

                Best regards,
                Alicia Moreau
                Northway Property Management
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-0016',
            'from' => 'Priya Nair <priya.nair@mail.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for getting on this so quickly. I'm working from home today, so whoever is coming can buzz 2B and I'll let them in. The space heater is keeping the bedroom warm enough for now. Let me know if they need me to do anything with the thermostat before they arrive.

                Priya
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-script-01',
            'from' => 'Marcus Leblanc <marcus.leblanc@mail.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for looking into the fan. I'm home most afternoons before my shift, so any time between 2 and 5 works if someone needs to come up. I've stopped using it for now so it doesn't get any worse.

                Marcus
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-script-04',
            'from' => 'Northway Property Management <hello@northwaypm.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for getting back to us about the eavestroughs. We've pencilled you in for the first dry day after the big trees on your street drop their leaves. The crew will flag anything they notice along the roof edge while they're up there.

                Best regards,
                Alicia Moreau
                Northway Property Management
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-script-06',
            'from' => 'Dufferin Plumbing <service@dufferinplumbing.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for the quick reply on the hot water tank. We can do the inspection on the same visit as the condensate line repair in 3A, if that suits you. The hot water will only be off for about half an hour while we drain a few litres from the tank.

                Thanks,
                Rob Kowalczyk
                Service coordinator, Dufferin Plumbing
                TEXT,
            'attachments' => [],
        ],
        [
            'thread_id' => 'thread-script-08',
            'from' => 'Priya Nair <priya.nair@mail.example>',
            'body_text' => <<<'TEXT'
                Hi Dana,

                Thanks for looking into the door. Until it's fixed, I've been checking that it latches in the evening. Marcus said he'd do the same after his shifts.

                Priya
                TEXT,
            'attachments' => [],
        ],
    ],
];
