<?php

use App\Enums\CaseStatus;
use App\Enums\FixtureFile;
use App\Enums\MessageDirection;

return [
    [
        'number' => 'CASE-0001',
        'thread_id' => 'thread-0001',
        'sender' => 'jade.okafor@mail.example',
        'subject' => 'Window latch broken, unit 1A',
        'issue' => 'Bedroom window latch in 1A snapped off; the window closes but will not lock.',
        'notes' => 'Replaced the latch two days later. Hardware store part, $18.97, paid by me.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0001-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 41, 'minutes' => 300],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The latch on the bedroom window in 1A snapped off earlier today when I went to close it. The window still shuts, but it won't lock and it rattles when the wind picks up. I'm on the ground floor, so I'd feel a lot better if it could be fixed soon. I'm home most evenings after 6 if someone needs to come in.

                    Thanks,
                    Jade
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0001-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 41, 'minutes' => 120],
                'body_text' => <<<'TEXT'
                    Hi Jade,

                    Thanks for letting me know, and sorry about that. I'll pick up a replacement latch tomorrow and can come by in a couple of days to install it. In the meantime, a wooden dowel in the track will keep the window from sliding open. Let me know which evening works best for you.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::InProgress, 'ago' => ['days' => 41, 'minutes' => 110]],
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 39, 'minutes' => 300]],
        ],
    ],
    [
        'number' => 'CASE-0002',
        'thread_id' => 'thread-0002',
        'sender' => 'hello@northwaypm.example',
        'subject' => 'Smoke alarm and extinguisher check',
        'issue' => 'Annual check of the smoke alarms, carbon monoxide alarms and the front hall extinguisher.',
        'notes' => 'All passed. Batteries replaced in 2B and 3A. Next check due next fall.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0002-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 39, 'minutes' => 200],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Our annual life safety visit for 61 Brenwick Avenue is coming up. Our technician will test the smoke and carbon monoxide alarms in all three units and check the extinguisher in the front hall. The visit takes about an hour, and we give each tenant written notice a day ahead. Could you confirm that a morning visit early next week works for you?

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0002-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 39, 'minutes' => 60],
                'body_text' => <<<'TEXT'
                    Hi Alicia,

                    A morning early next week is fine. Jade is still in 1A until the end of the month, so please include her in the notice. Marcus in 3A works nights, so a start after 10 would be kind to him. Thanks for organizing this.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0002-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 36, 'minutes' => 400],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The life safety visit is done. All smoke and carbon monoxide alarms passed, and we replaced the batteries in 2B and 3A while we were there. The extinguisher in the front hall is tagged and good for another year. You'll see the visit on this month's statement at our usual rate.

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 36, 'minutes' => 380]],
        ],
    ],
    [
        'number' => 'CASE-0003',
        'thread_id' => 'thread-0003',
        'sender' => 'marcus.leblanc@mail.example',
        'subject' => 'Parking spot swap',
        'issue' => 'Marcus (3A) and Priya (2B) want to trade parking spots.',
        'notes' => 'Swap confirmed by both. Parking list updated and Northway told for the snow crew.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0003-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 36, 'minutes' => 700],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Would it be possible to swap my parking spot for the one by the side door? I've started night shifts at the hospital, and backing out of the rear spot in the dark means inching past Priya's car every time. I asked Priya and she doesn't mind trading, since she works from home most days and bikes in on office days. Let me know what you think.

                    Thanks,
                    Marcus
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0003-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 36, 'minutes' => 500],
                'body_text' => <<<'TEXT'
                    Hi Marcus,

                    That's fine with me as long as Priya is on board. I'll update the parking list and let Northway know so the snow clearing crew works around the new spots. Could you double-check with Priya that she's happy with the swap?

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0003-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 35, 'minutes' => 900],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Priya says she's happy with it, and she said she'd mention it when she sees you. We'll move the cars over in the next few days. Thanks for sorting this out so quickly.

                    Marcus
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0003-04',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 35, 'minutes' => 800],
                'body_text' => <<<'TEXT'
                    Hi Marcus,

                    Priya confirmed when I saw her earlier today, so the swap is official. Your spot is now the one by the side door, and the parking list on the laundry room board is updated. Thanks for arranging it between you.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 35, 'minutes' => 790]],
        ],
    ],
    [
        'number' => 'CASE-0004',
        'thread_id' => 'thread-0004',
        'sender' => 'service@dufferinplumbing.example',
        'subject' => 'Boiler fall start-up booked',
        'issue' => 'Annual fall start-up service for the boiler.',
        'notes' => 'Done. Pressure 12 psi. Circulator pump is noisy; budget for a replacement in one to two years. Paid $213.57 by e-transfer.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0004-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 34, 'minutes' => 300],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    This is a reminder that your boiler is due for its fall start-up service. We have you booked for later this week, between 8 and 10 in the morning. The technician will check the pressure, bleed the radiators on each floor, test the safety controls and clean the burner. The visit is our standard $189 plus HST. Please let us know how we can get into the basement.

                    Thanks,
                    Rob Kowalczyk
                    Service coordinator, Dufferin Plumbing
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0004-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 34, 'minutes' => 200],
                'body_text' => <<<'TEXT'
                    Hi Rob,

                    That time works. The basement key is in the lockbox by the side door, and I'll text you the code that morning. Please knock on 2B before you bleed the radiators, since Priya works from home most days. Thanks.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0004-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 31, 'minutes' => 500],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The start-up is done and the boiler is running well. System pressure reads 12 psi, all radiators were bled, and the low-water cut-off tested fine. Our technician noted that the circulator pump is getting noisy and may need replacing in the next year or two. You can pay by e-transfer to our usual address whenever it suits you.

                    Thanks,
                    Rob Kowalczyk
                    Service coordinator, Dufferin Plumbing
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::InProgress, 'ago' => ['days' => 34, 'minutes' => 190]],
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 31, 'minutes' => 480]],
        ],
    ],
    [
        'number' => 'CASE-0005',
        'thread_id' => 'thread-0005',
        'sender' => 'jade.okafor@mail.example',
        'subject' => 'Move-out walkthrough and keys, unit 1A',
        'issue' => 'Jade is moving out of 1A at the end of the month; walkthrough and key return.',
        'notes' => 'Walkthrough done and the unit is in good shape. Two keys and the laundry card returned. Forwarding address on file.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0005-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 31, 'minutes' => 1000],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    As we discussed, I'm moving out of 1A at the end of the month. The movers are booked for the last weekend of the month, and I'll have the place cleaned the day after. Could we do the walkthrough once the cleaners are done? I'll hand over both keys and the laundry card then, along with my forwarding address.

                    Thanks,
                    Jade
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0005-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 31, 'minutes' => 700],
                'body_text' => <<<'TEXT'
                    Hi Jade,

                    That works, so let's plan on the afternoon after the cleaners finish. I'll bring the move-out checklist and we can go through it together. Thanks for being such a good tenant these past three years. We'll miss you in the building.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 28, 'minutes' => 300]],
        ],
    ],
    [
        'number' => 'CASE-0006',
        'thread_id' => 'thread-0006',
        'sender' => 'priya.nair@mail.example',
        'subject' => 'Late-night noise from upstairs',
        'issue' => 'Music and footsteps from 3A after midnight are waking 2B.',
        'notes' => 'Spoke with Marcus, who is on night shifts. Rug down and quiet after 11. Priya confirms it is better.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0006-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 28, 'minutes' => 120],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    I'm sorry to bring this up, but for the past week there has been loud music and heavy footsteps from upstairs after midnight. Some nights it goes on for hours, and I start work early. I don't want to turn this into a Landlord and Tenant Board thing, and I'm sure it isn't on purpose. Could you have a word with them?

                    Thanks,
                    Priya
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0006-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 27, 'minutes' => 1200],
                'body_text' => <<<'TEXT'
                    Hi Priya,

                    Thanks for telling me, and I'm sorry you've been losing sleep. I spoke with Marcus earlier today. He's been working night shifts and didn't realize how much sound carries through the old floors when he gets home. He's putting down a rug and moving his speaker off the floor, and he'll keep things quiet after 11. Please let me know if it doesn't improve over the next few nights.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0006-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 25, 'minutes' => 600],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Just a quick update: it's been much quieter the last few nights. I heard him come in late one night, and it was barely noticeable. Please thank Marcus for me. The rug makes a real difference.

                    Priya
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0006-04',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 25, 'minutes' => 500],
                'body_text' => <<<'TEXT'
                    Hi Priya,

                    That's great to hear. I'll pass your thanks along to Marcus. I'll close this off for now, but please write again if it starts up.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 25, 'minutes' => 490]],
        ],
    ],
    [
        'number' => 'CASE-0007',
        'thread_id' => 'thread-0007',
        'sender' => 'jade.okafor@mail.example',
        'subject' => 'Deposit return, unit 1A',
        'issue' => 'Return of the key deposit and the interest on the last month\'s rent deposit after move-out.',
        'notes' => 'Sent $116.40 by e-transfer: $75 key deposit plus $41.40 interest. Jade confirmed receipt.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0007-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 26, 'minutes' => 800],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    I've settled into the new place. Thanks again for the easy walkthrough. Could you let me know when to expect the $75 key deposit back? I also remember you mentioning interest on my last month's rent deposit, so I wanted to check whether that would come at the same time. E-transfer to this address is easiest for me.

                    Thanks,
                    Jade
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0007-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 26, 'minutes' => 400],
                'body_text' => <<<'TEXT'
                    Hi Jade,

                    I've just sent an e-transfer for $116.40 to this address. That's the $75 key deposit plus $41.40 in interest on your last month's rent deposit for this year. It should arrive within the hour. Wishing you all the best in the new place.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0007-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 25, 'minutes' => 1300],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The e-transfer came through, thank you. Everything looks right to me. If any mail turns up for me at the old unit, my forwarding address is the one I gave you at the walkthrough.

                    Thanks again,
                    Jade
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 25, 'minutes' => 1290]],
        ],
    ],
    [
        'number' => 'CASE-0008',
        'thread_id' => 'thread-0008',
        'sender' => 'hello@northwaypm.example',
        'subject' => 'Unit 1A turnover: cleaning and paint',
        'issue' => 'Turnover of 1A after Jade moved out: deep clean and paint.',
        'notes' => 'Approved $1,350 plus HST for paint, same off-white as the other units. Finished; showings started.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0008-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 24, 'minutes' => 500],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Now that 1A is empty, here is the plan for the turnover. Our cleaners can do a deep clean early next week, and our painter can start the day after and finish within three days. Painting the living room, bedroom and hallway with two coats comes to $1,350 plus HST, with the trim and bathroom left as is. We'd like to start showing the unit the following week. Please reply to approve and we'll book the crew.

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0008-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 24, 'minutes' => 300],
                'body_text' => <<<'TEXT'
                    Hi Alicia,

                    Approved, thank you. Please use the same off-white as the other units so touch-ups stay simple. The cabinet door under the kitchen sink in 1A is loose, so could the painter tighten the hinge while he's there?

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0008-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 20, 'minutes' => 600],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The turnover is finished. The unit has been cleaned top to bottom, the painting is done, and the painter tightened the cabinet hinge at no charge. Photos are in the owner portal, and we've started booking showings. I'll send you the applications as they come in.

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::InProgress, 'ago' => ['days' => 24, 'minutes' => 290]],
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 20, 'minutes' => 580]],
        ],
    ],
    [
        'number' => 'CASE-0009',
        'thread_id' => 'thread-0009',
        'sender' => 'marcus.leblanc@mail.example',
        'subject' => 'Dryer not heating in the laundry room',
        'issue' => 'The basement dryer runs but does not heat.',
        'notes' => 'Likely the heating element. Part ordered from the appliance supplier for $84.50; on back order. I will install it myself.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0009-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 21, 'minutes' => 900],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The dryer in the basement laundry room runs, but it isn't heating anymore. I ran a load twice yesterday and everything came out just as wet. The lint trap is clean, so I don't think it's a blockage. I've put a note on it so nobody else loses a load.

                    Thanks,
                    Marcus
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0009-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 21, 'minutes' => 600],
                'body_text' => <<<'TEXT'
                    Hi Marcus,

                    Thanks for putting the note on the machine. It sounds like the heating element, which is what went on the old dryer too. I've ordered the part, but the supplier says it's on back order for two to three weeks. Until then the washer still works, and you're welcome to use the drying rack in the storage room.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::InProgress, 'ago' => ['days' => 21, 'minutes' => 590]],
        ],
    ],
    [
        'number' => 'CASE-0010',
        'thread_id' => 'thread-0010',
        'sender' => 'priya.nair@mail.example',
        'subject' => 'Tub caulking coming away, unit 2B',
        'issue' => 'Caulking along the tub in 2B is peeling; possible mildew behind it.',
        'notes' => 'Plan to recaulk myself. Buy mildew-resistant silicone.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0010-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 17, 'minutes' => 400],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The caulking along the back of the bathtub in 2B is starting to peel away from the tile. There's a dark line behind it that I think is mildew, and I'm worried water is getting in behind the wall. It isn't urgent, but I'd rather catch it before it gets worse. I'm flexible on timing.

                    Thanks,
                    Priya
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0010-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 17, 'minutes' => 100],
                'body_text' => <<<'TEXT'
                    Hi Priya,

                    Thanks for catching this early. I'll come by to take a look and redo the caulking myself, probably on a weekend in the next couple of weeks. Please avoid scrubbing the gap in the meantime so it doesn't open up further.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [],
    ],
    [
        'number' => 'CASE-0011',
        'thread_id' => 'thread-0011',
        'sender' => 'service@dufferinplumbing.example',
        'subject' => 'Invoice 2291: furnace filter and service',
        'issue' => 'Invoice 2291 for the furnace service in 3A: new filter and flame sensor cleaning.',
        'notes' => 'Paid $226.00 by e-transfer. Filter size 16x25x1, MERV 8.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0011-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 14, 'minutes' => 600],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Please find attached invoice 2291 for this week's visit to the furnace in unit 3A. Our technician replaced the filter, cleaned the flame sensor and checked the venting. The total comes to $226.00 including HST. Payment by e-transfer within 30 days is fine.

                    Thanks,
                    Rob Kowalczyk
                    Service coordinator, Dufferin Plumbing
                    TEXT,
                'attachments' => [FixtureFile::FurnaceFilterInvoice],
            ],
            [
                'gmail_message_id' => 'msg-0011-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 13, 'minutes' => 1300],
                'body_text' => <<<'TEXT'
                    Hi Rob,

                    Thanks, I've just sent the e-transfer for $226.00. Please note the filter size on our file so whoever comes next brings the right one. I'll close this off on my end.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::Closed, 'ago' => ['days' => 13, 'minutes' => 1290]],
        ],
    ],
    [
        'number' => 'CASE-0012',
        'thread_id' => 'thread-0012',
        'sender' => 'hello@northwaypm.example',
        'subject' => 'Applications for unit 1A',
        'issue' => 'Choose a new tenant for 1A from three applications.',
        'notes' => 'Second applicant preferred. References positive. She wants to move in on the first of next month.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0012-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 11, 'minutes' => 300],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    We've had good interest in 1A since the showings started, and three complete applications are now in the owner portal. Each one includes proof of income, a credit report and two references. Our pick would be the second applicant, a nurse relocating from Ottawa, but all three meet your criteria. Let us know which one you'd like to go with and we'll prepare the lease.

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0012-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 10, 'minutes' => 900],
                'body_text' => <<<'TEXT'
                    Hi Alicia,

                    Thanks for pulling these together. I'm leaning toward the second applicant as well. Before I decide, could you check both of her references and confirm the start date she's asking for?

                    Dana
                    TEXT,
                'attachments' => [],
            ],
            [
                'gmail_message_id' => 'msg-0012-03',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 9, 'minutes' => 400],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Both references came back positive, and her current landlord said she was quiet and always paid on time. She's hoping to move in on the first of next month. Once you confirm, we'll send the standard Ontario lease for signature and collect the first and last months' rent.

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [],
    ],
    [
        'number' => 'CASE-0013',
        'thread_id' => 'thread-0013',
        'sender' => 'service@dufferinplumbing.example',
        'subject' => 'Quote: main shut-off valve replacement',
        'issue' => 'The main water shut-off in the basement is seized; Dufferin quotes a replacement.',
        'notes' => 'Quote is $385 plus HST. Tenants need notice of the water shut-off before the work.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0013-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 7, 'minutes' => 500],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    During the boiler start-up last month, our technician noticed that the main water shut-off valve in the basement is seized. If a pipe ever burst, you wouldn't be able to turn off the water to the building. We recommend replacing it with a quarter-turn ball valve, which takes about two hours. The cost is $385 plus HST, parts and labour included, and the water would be off for the whole building during the work. Let us know if you'd like to book it.

                    Thanks,
                    Rob Kowalczyk
                    Service coordinator, Dufferin Plumbing
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [],
    ],
    [
        'number' => 'CASE-0014',
        'thread_id' => 'thread-0014',
        'sender' => 'marcus.leblanc@mail.example',
        'subject' => 'Kitchen sink leaking, unit 3A',
        'issue' => 'Leak at the kitchen sink drain in 3A, worse when the dishwasher runs.',
        'notes' => 'Dufferin booked for the next morning. Check the cabinet floor for water damage after the repair.',
        'messages' => [
            [
                'gmail_message_id' => 'msg-0014-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 4, 'minutes' => 800],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    There's water pooling in the cabinet under my kitchen sink. It looks like it's coming from the drain pipe where it joins the wall, and it gets worse when I run the dishwasher. I've put a bucket under it and stopped using the dishwasher for now. I've attached a photo so you can see where it's dripping.

                    Thanks,
                    Marcus
                    TEXT,
                'attachments' => [FixtureFile::KitchenSinkLeak],
            ],
            [
                'gmail_message_id' => 'msg-0014-02',
                'direction' => MessageDirection::Outbound,
                'ago' => ['days' => 4, 'minutes' => 650],
                'body_text' => <<<'TEXT'
                    Hi Marcus,

                    Thanks for the photo, it really helps. I've booked Dufferin Plumbing for tomorrow between 9 and 11, and they'll use the lockbox key if you're asleep after your shift. Please clear out the cabinet under the sink before then. Keep the dishwasher off until they've had a look.

                    Dana
                    TEXT,
                'attachments' => [],
            ],
        ],
        'status_changes' => [
            ['to' => CaseStatus::InProgress, 'ago' => ['days' => 4, 'minutes' => 640]],
        ],
    ],
    [
        'number' => 'CASE-0015',
        'thread_id' => 'thread-0015',
        'sender' => 'hello@northwaypm.example',
        'subject' => 'Snow clearing quote for the winter',
        'issue' => 'Northway\'s snow clearing quote for the season: $1,740 plus HST.',
        'notes' => null,
        'messages' => [
            [
                'gmail_message_id' => 'msg-0015-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 2, 'minutes' => 400],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    Attached is our snow clearing quote for 61 Brenwick Avenue for the coming season. The seasonal contract covers the driveway, front walk and side path whenever snowfall reaches 5 cm, with salting on the steps and walkways. The total is $1,740 plus HST for the season, the same rate as last year. We've also added an optional fall eavestrough cleaning at $220 plus HST. Please let us know by the end of the month so we can hold your spot on the route.

                    Best regards,
                    Alicia Moreau
                    Northway Property Management
                    TEXT,
                'attachments' => [FixtureFile::SnowClearingQuote],
            ],
        ],
        'status_changes' => [],
    ],
    [
        'number' => 'CASE-0016',
        'thread_id' => 'thread-0016',
        'sender' => 'priya.nair@mail.example',
        'subject' => 'Boiler not firing, unit 2B',
        'issue' => null,
        'notes' => null,
        'messages' => [
            [
                'gmail_message_id' => 'msg-0016-01',
                'direction' => MessageDirection::Inbound,
                'ago' => ['days' => 0, 'minutes' => 95],
                'body_text' => <<<'TEXT'
                    Hi Dana,

                    The heat in 2B stopped sometime overnight, and I woke up early because the bedroom was freezing. The radiators are cold and the thermostat is showing an error code. I tried switching it off and on again, but the error comes right back. It's down to 16 degrees in the living room, so I'm running a space heater for now. I've attached a photo of the thermostat screen.

                    Thanks,
                    Priya
                    TEXT,
                'attachments' => [FixtureFile::ThermostatError],
            ],
        ],
        'status_changes' => [],
    ],
];
