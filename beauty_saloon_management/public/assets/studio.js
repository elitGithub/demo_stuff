"use strict";

document.querySelector("[data-menu]")?.addEventListener("click", (event) => {
    const open = document.querySelector("#sidebar").classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
    const sidebar = document.querySelector("#sidebar");
    if (
        sidebar?.classList.contains("open") &&
        !sidebar.contains(event.target) &&
        !event.target.closest("[data-menu]")
    ) {
        sidebar.classList.remove("open");
        document
            .querySelector("[data-menu]")
            ?.setAttribute("aria-expanded", "false");
    }
});
document.querySelectorAll("[data-toggle]").forEach((button) =>
    button.addEventListener("click", () => {
        const target = document.getElementById(button.dataset.toggle);
        target.hidden = !target.hidden;
        button.setAttribute("aria-expanded", String(!target.hidden));
        if (!target.hidden) target.querySelector("input")?.focus();
    }),
);
const confirmedForms = new WeakSet();
document.querySelectorAll("[data-confirm]").forEach((form) =>
    form.addEventListener("submit", (event) => {
        if (confirmedForms.has(form)) return;
        event.preventDefault();
        const submitter = event.submitter;
        const dialog = document.createElement("dialog");
        dialog.className = "confirmation-dialog";
        dialog.setAttribute("aria-label", "Confirm action");
        const message = document.createElement("p");
        message.textContent = form.dataset.confirm;
        const actions = document.createElement("div");
        actions.className = "action-row";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "button secondary";
        cancel.textContent = "Go back";
        cancel.addEventListener("click", () => dialog.close());
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.className = "button";
        confirm.textContent = "Confirm";
        confirm.addEventListener("click", () => {
            confirmedForms.add(form);
            dialog.close();
            form.requestSubmit(submitter);
        });
        dialog.addEventListener("close", () => dialog.remove());
        actions.append(cancel, confirm);
        dialog.append(message, actions);
        document.body.append(dialog);
        dialog.showModal();
        cancel.focus();
    }),
);
document.querySelectorAll("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
        document
            .querySelectorAll("[data-view]")
            .forEach((tab) => tab.classList.toggle("selected", tab === button));
        document.querySelectorAll("[data-calendar-view]").forEach((panel) => {
            panel.hidden = panel.dataset.calendarView !== button.dataset.view;
        });
    }),
);
const bookingForm = document.getElementById("booking-form");
if (bookingForm) {
    const stylist = document.getElementById("booking-stylist");
    const date = document.getElementById("booking-date");
    const time = document.getElementById("booking-time");
    const status = document.getElementById("availability-status");
    const submit = document.getElementById("booking-submit");
    const serviceInputs = Array.from(
        bookingForm.querySelectorAll('[name="service_ids[]"]'),
    );
    let currentRequest;
    let previousTime = bookingForm.dataset.oldTime || "";
    const formatter = new Intl.NumberFormat("en", {
        style: "currency",
        currency: bookingForm.dataset.currency,
    });
    function updateSummary() {
        const selected = serviceInputs.filter((input) => input.checked);
        const total = selected.reduce(
            (sum, input) => sum + Number(input.dataset.price),
            0,
        );
        const duration = selected.reduce(
            (sum, input) => sum + Number(input.dataset.duration),
            0,
        );
        document.getElementById("booking-total").textContent = formatter.format(
            total / 100,
        );
        document.getElementById("booking-duration").textContent =
            duration + " min";
        const list = document.getElementById("selected-services");
        list.replaceChildren();
        selected.forEach((input) => {
            const row = document.createElement("div");
            const name = document.createElement("span");
            const price = document.createElement("span");
            name.textContent = input.dataset.name;
            price.textContent = formatter.format(
                Number(input.dataset.price) / 100,
            );
            row.append(name, price);
            list.append(row);
        });
        return selected;
    }
    async function refresh() {
        currentRequest?.abort();
        currentRequest = new AbortController();
        const selected = updateSummary();
        submit.disabled = true;
        time.replaceChildren(new Option("Choose a time", ""));
        if (!selected.length || !date.value || !stylist.value) {
            status.textContent =
                "Choose a stylist, at least one service and a date to see available times.";
            return;
        }
        if (selected.some((input) => input.dataset.eligible !== "true")) {
            status.textContent =
                "Some selected services are unavailable. Choose a qualified stylist or remove those services to continue.";
            return;
        }
        const url = new URL(bookingForm.dataset.availability, location.origin);
        url.searchParams.set("stylist_id", stylist.value);
        url.searchParams.set("date", date.value);
        selected.forEach((input) =>
            url.searchParams.append("service_ids[]", input.value),
        );
        status.textContent = "Finding a little time for you…";
        try {
            const response = await fetch(url, {
                signal: currentRequest.signal,
                headers: { Accept: "application/json" },
            });
            const data = await response.json();
            if (!response.ok)
                throw new Error(
                    data.message ||
                        "Could not check availability. Please try again.",
                );
            data.slots.forEach((slot) =>
                time.add(new Option(slot, slot, false, slot === previousTime)),
            );
            previousTime = "";
            status.textContent = data.slots.length
                ? `${data.slots.length} times available. Your whole visit is reserved with the same stylist.`
                : "No times available on this day. Try another date or stylist.";
            submit.disabled = data.slots.length === 0;
        } catch (error) {
            if (error.name === "AbortError") return;
            status.textContent = error.message;
        }
    }
    function changeStylist() {
        const ids = (stylist.selectedOptions[0]?.dataset.services || "").split(
            ",",
        );
        serviceInputs.forEach((input) => {
            const eligible =
                input.dataset.active === "1" && ids.includes(input.value);
            input.dataset.eligible = String(eligible);
            const label = input.closest(".service-option");
            label.classList.toggle("unavailable", !eligible);
            label.querySelector("[data-service-eligibility]").textContent =
                eligible
                    ? ""
                    : input.dataset.active !== "1"
                      ? "No longer offered — remove this selection to continue."
                      : "Not offered by this stylist.";
        });
        refresh();
    }
    stylist.addEventListener("change", changeStylist);
    date.addEventListener("change", refresh);
    serviceInputs.forEach((input) => input.addEventListener("change", refresh));
    document
        .getElementById("booking-client")
        ?.addEventListener("change", (event) => {
            const url = new URL(event.target.dataset.url, location.origin);
            if (event.target.value)
                url.searchParams.set("client", event.target.value);
            location.assign(url);
        });
    bookingForm.addEventListener("submit", () => {
        submit.disabled = true;
        submit.textContent = "Saving your appointment…";
    });
    changeStylist();
}
