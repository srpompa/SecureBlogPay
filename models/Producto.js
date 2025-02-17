const mongoose = require('mongoose');

const productoSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    precio: { type: Number, required: true },
    imagenUrl: { type: String, required: true },
    descripcion: { type: String },
    createdAt: { type: Date }
});

module.exports = mongoose.model('Producto', productoSchema);