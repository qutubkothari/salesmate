// services/paymentService.js

/**
 * Generate payment details message with bank info and GST breakdown
 */
const generatePaymentDetails = async (tenant, amount, orderId, showGSTBreakdown = true) => {
    try {
        let paymentMessage = `💳 **Payment Details**\n\n`;
        
        // GST breakdown if requested
        if (showGSTBreakdown) {
            const gstCalculation = calculateReverseGST(amount, 0.18);
            paymentMessage += `**Amount Breakdown:**\n`;
            paymentMessage += `Subtotal: ₹${gstCalculation.subtotal.toFixed(2)}\n`;
            paymentMessage += `GST (18%): ₹${gstCalculation.gstAmount.toFixed(2)}\n`;
            paymentMessage += `**Total: ₹${amount.toFixed(2)}**\n\n`;
        }
        
        // Bank transfer details
        if (tenant.payment_bank_name) {
            paymentMessage += `🏦 **Bank Transfer:**\n`;
            paymentMessage += `Bank: ${tenant.payment_bank_name}\n`;
            paymentMessage += `Account: ${tenant.payment_account_holder || tenant.business_name}\n`;
            paymentMessage += `A/C No: ${tenant.payment_account_number}\n`;
            paymentMessage += `IFSC: ${tenant.payment_ifsc_code}\n`;
            paymentMessage += `Amount: ₹${amount.toFixed(2)} (inclusive of GST)\n\n`;
        }
        
        // UPI details
        if (tenant.payment_upi_id) {
            paymentMessage += `📱 **UPI Payment:**\n`;
            paymentMessage += `UPI ID: ${tenant.payment_upi_id}\n`;
            paymentMessage += `Amount: ₹${amount.toFixed(2)}\n\n`;
        }
        
        // QR Code
        if (tenant.payment_qr_code_url) {
            paymentMessage += `📱 **Scan QR Code for Quick Payment:**\n`;
            // QR code will be sent as separate image message
        }
        
        // Default payment info if no details configured
        if (!tenant.payment_bank_name && !tenant.payment_upi_id) {
            paymentMessage += `Please contact us for payment details.\n`;
            paymentMessage += `Total Amount: ₹${amount.toFixed(2)} (inclusive of GST)\n\n`;
        }
        
        // Reference info
        paymentMessage += `📋 **Order Reference:** ${orderId}\n`;
        paymentMessage += `Please share payment screenshot after transfer.`;
        
        return paymentMessage;
        
    } catch (error) {
        console.error('Error generating payment details:', error.message);
        return `Total: ₹${amount.toFixed(2)} (inclusive of GST)\nOrder ID: ${orderId}`;
    }
};

/**
 * Calculate GST for given subtotal
 */
const calculateGST = (subtotal, gstRate = 0.18) => {
    const gstAmount = subtotal * gstRate;
    const total = subtotal + gstAmount;
    
    return {
        subtotal: parseFloat(subtotal.toFixed(2)),
        gstAmount: parseFloat(gstAmount.toFixed(2)),
        total: parseFloat(total.toFixed(2)),
        gstRate: gstRate
    };
};

/**
 * Calculate reverse GST (when total includes GST)
 */
const calculateReverseGST = (totalWithGST, gstRate = 0.18) => {
    const subtotal = totalWithGST / (1 + gstRate);
    const gstAmount = totalWithGST - subtotal;
    
    return {
        subtotal: parseFloat(subtotal.toFixed(2)),
        gstAmount: parseFloat(gstAmount.toFixed(2)),
        total: parseFloat(totalWithGST.toFixed(2)),
        gstRate: gstRate
    };
};

/**
 * Format payment amount with currency
 */
const formatPaymentAmount = (amount, currency = '₹') => {
    return `${currency}${parseFloat(amount).toFixed(2)}`;
};

module.exports = {
    generatePaymentDetails,
    calculateGST,
    calculateReverseGST,
    formatPaymentAmount
};
