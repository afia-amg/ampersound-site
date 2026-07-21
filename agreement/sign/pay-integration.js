// This script is loaded by the signing page to add payment buttons
// It runs after agreementData is loaded and handles:
// 1. Success overlay: adds Pay Now button after signing
// 2. View mode: shows Paid badge or Pay Balance button

(function() {
  // Wait for agreementData to be available
  const checkData = setInterval(function() {
    if (typeof agreementData === 'undefined' || agreementData === null) return;
    clearInterval(checkData);
    initPaymentButtons();
  }, 200);

  function initPaymentButtons() {
    const d = agreementData;
    if (!d) return;

    // Add Pay Now to success overlay (after signing)
    if (d.paymentLink) {
      const successOverlay = document.getElementById('successOverlay');
      if (successOverlay) {
        const existingP = successOverlay.querySelector('p');
        const payBtn = document.createElement('a');
        payBtn.href = d.paymentLink;
        payBtn.style.cssText = 'display:inline-block;padding:14px 32px;background:#c9a96e;color:#0f1114;text-decoration:none;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:700;font-size:0.9rem;margin-top:1rem;transition:background 200ms;';
        payBtn.textContent = d.depositAmount ? `Pay Deposit ($${Number(d.depositAmount).toLocaleString()})` : 'Pay Deposit';
        payBtn.onmouseover = function() { this.style.background = '#e0c48a'; };
        payBtn.onmouseout = function() { this.style.background = '#c9a96e'; };
        existingP.insertAdjacentElement('afterend', payBtn);
      }
    }

    // Add payment status to view mode (signed agreements)
    const sigSectionView = document.getElementById('sigSectionView');
    if (sigSectionView && sigSectionView.style.display !== 'none') {
      const footer = document.querySelector('.doc-footer');
      if (footer && d.paymentLink) {
        const paySection = document.createElement('div');
        paySection.style.cssText = 'text-align:center;margin-top:2rem;padding:2rem;background:oklch(19% 0.008 250);border:1px solid oklch(35% 0.02 70/0.2);border-radius:12px;';

        // Check if paid (from payment status in data or URL param)
        const params = new URLSearchParams(window.location.search);
        const isPaid = params.get('paid') === 'true';

        if (isPaid) {
          paySection.innerHTML = '<div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:0.85rem;color:#4ade80;">&#10003; Payment Received</div><p style="color:oklch(55% 0.01 70);font-size:0.78rem;margin-top:0.5rem;">Your deposit has been received. Thank you!</p>';
        } else {
          paySection.innerHTML = `<p style="color:oklch(78% 0.008 70);font-size:0.88rem;margin-bottom:1rem;">Ready to secure your date?</p><a href="${d.paymentLink}" style="display:inline-block;padding:14px 32px;background:#c9a96e;color:#0f1114;text-decoration:none;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:700;font-size:0.9rem;">${d.depositAmount ? 'Pay Deposit ($' + Number(d.depositAmount).toLocaleString() + ')' : 'Pay Deposit'}</a>`;
        }

        footer.insertAdjacentElement('beforebegin', paySection);
      }
    }
  }
})();