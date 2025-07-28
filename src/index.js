const express = require('express');
const QRCode = require('qrcode');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser')
app.use(cors({
    origin: 'https://8f54vp0d-5173.inc1.devtunnels.ms'
}));

app.use(bodyParser.json());

const orderId = 'ORD-239231';
var amount = 0;

const generateQR = async (upiString) => {
    try {
        const qr = await QRCode.toDataURL(upiString);
        return qr;
    }
    catch (err) {
        console.error(err);
    }
}

app.post('/QR', async (req, res) => {
    amount = parseInt(req.body.Amount);
    const upiString = `upi://pay?pa=7378160677-2@axl&pn=Irfan&am=${amount}&cu=INR&tr=${orderId}`;
    const QR = await generateQR(upiString);
    return res.status(200).json({
        qr: QR
    })
})

app.listen(3000);