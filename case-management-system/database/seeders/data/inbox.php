<?php

return [
    'messages' => [
        [
            'gmail_message_id' => 'msg-news-01',
            'thread_id' => 'thread-news-01',
            'from' => 'Lakeshore Utilities <news@lakeshoreutilities.example>',
            'subject' => 'Your fall energy-saving newsletter',
            'ago' => ['days' => 5, 'minutes' => 600],
            'body_text' => <<<'TEXT'
                Hello Dana,

                This month's newsletter is all about saving energy as the days get shorter. Washing laundry in cold water and switching the last few bulbs to LEDs are two of the easiest changes. A programmable thermostat set a few degrees lower overnight can trim your heating costs noticeably. Our home efficiency rebate program is open again, and the details are in your online account.

                The Lakeshore Utilities team
                TEXT,
        ],
        [
            'gmail_message_id' => 'msg-jade-01',
            'thread_id' => 'thread-jade-01',
            'from' => 'Jade Okafor <jade.okafor@mail.example>',
            'subject' => 'Mail for me at the old unit',
            'ago' => ['days' => 9, 'minutes' => 800],
            'body_text' => <<<'TEXT'
                Hi Dana,

                Sorry to bother you again. I'm expecting a cheque from my old employer that may have gone to 1A by mistake. If anything with my name on it turns up, could you hold it for me and let me know? I can pick it up any evening.

                Thanks,
                Jade
                TEXT,
        ],
        [
            'gmail_message_id' => 'msg-sam-01',
            'thread_id' => 'thread-sam-01',
            'from' => 'Sam Whitfield <sam.whitfield@mail.example>',
            'subject' => 'Your extension ladder',
            'ago' => ['days' => 3, 'minutes' => 300],
            'body_text' => <<<'TEXT'
                Hey Dana,

                Any chance I could borrow your extension ladder for a couple of days? I finally have to clean out the eavestroughs before the leaves bury the whole house. I can pick it up whenever suits you and have it back within a day or two. Say hi to Aunt Carol for me, and tell her I still owe her a pie.

                Sam
                TEXT,
        ],
    ],
    'notifications' => [
        'from' => 'Casefile <notifications@casefile.example>',
        'subject' => 'New case :number: :subject',
        'body_text' => <<<'TEXT'
            Casefile opened :number from an email sent by :name (:email).

            Subject: :subject

            Open Casefile to read the full message and reply.
            TEXT,
        'cases' => [
            ['number' => 'CASE-0015', 'gmail_message_id' => 'msg-notify-0015', 'thread_id' => 'thread-notify-0015'],
            ['number' => 'CASE-0016', 'gmail_message_id' => 'msg-notify-0016', 'thread_id' => 'thread-notify-0016'],
        ],
    ],
];
