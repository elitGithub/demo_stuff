document.querySelectorAll('[data-focus-reply]').forEach((control) => {
    control.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('reply-body').focus();
    });
});
