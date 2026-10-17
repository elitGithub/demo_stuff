const disclosures = Array.from(document.querySelectorAll('.app-bar [data-header-disclosure]'));

disclosures.forEach((disclosure) => {
    disclosure.addEventListener('toggle', () => {
        if (!disclosure.open) {
            return;
        }

        disclosures.forEach((other) => {
            if (other !== disclosure) {
                other.open = false;
            }
        });
    });
});

document.addEventListener('click', (event) => {
    disclosures.forEach((disclosure) => {
        if (disclosure.open && !disclosure.contains(event.target)) {
            disclosure.open = false;
        }
    });
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }

    const disclosure = disclosures.find((candidate) => candidate.open && candidate.contains(event.target));
    if (disclosure) {
        event.preventDefault();
        disclosure.open = false;
        disclosure.querySelector('summary').focus({ preventScroll: true });
    }
});

document.addEventListener('focusin', (event) => {
    disclosures.forEach((disclosure) => {
        if (disclosure.open && !disclosure.contains(event.target)) {
            disclosure.open = false;
        }
    });
});
