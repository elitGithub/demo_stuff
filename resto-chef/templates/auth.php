<div class="auth-layout">
    <div class="auth-story">
        <div class="eyebrow">WELCOME TO THE NEIGHBORHOOD</div>
        <h1>A good meal.<br>A better <em>day.</em></h1>
        <p>Save your favorites in your bag, keep an eye on your orders, and leave the cooking to us.</p>
        <div class="auth-flower">✳</div>
    </div>
    <section class="panel auth-panel">
        <div class="eyebrow"><?= $register ? 'LET’S GET TO KNOW YOU' : 'YOUR TABLE IS WAITING' ?></div>
        <h2><?= $register ? 'Create an account' : 'Sign in' ?></h2>
        <p class="muted"><?= $register ? 'A few details, and you’re ready to order.' : 'Welcome back. Something good is cooking.' ?></p>
        <form method="post" action="<?= $register ? '/register' : '/login' ?>"
              class="stack-form submit-once"><?= csrfField() ?><?php
            if ($register): ?><label>Your name<input name="name" autocomplete="name" minlength="2" maxlength="100"
                                                     required placeholder="Alex Morgan"></label><?php
            endif; ?><label>Email address<input name="email" type="email" autocomplete="username" maxlength="190"
                                                required placeholder="you@example.com"></label><label>Password<input
                        name="password" type="password"
                        autocomplete="<?= $register ? 'new-password' : 'current-password' ?>" <?= $register ? 'minlength="12"' : '' ?>
                        maxlength="72" required
                        placeholder="<?= $register ? 'At least 12 characters' : 'Your password' ?>"></label><?php
            if ($register): ?><p class="field-help">Use 12–72 bytes. A memorable passphrase works well.</p><?php
            endif; ?>
            <button class="button full-width" type="submit"><?= $register ? 'Create account' : 'Sign in' ?>
                <span>→</span></button>
        </form>
        <p class="auth-switch"><?= $register ? 'Already part of the table?' : 'New around here?' ?> <a
                    href="<?= $register ? '/login' : '/register' ?>"><?= $register ? 'Sign in' : 'Create an account' ?></a>
        </p></section>
</div>
