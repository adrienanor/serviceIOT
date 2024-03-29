// Importation des modules nécessaires
const express = require('express');
const mqtt = require('mqtt');
const mongoose = require('mongoose');
const axios = require('axios');


// Configuration du service web
const app = express();
const port = 80;
const pools = {};
const users = {};

// Configuration du broker MQTT
const mqttBrokerUrl = 'mqtt://mqtt.eclipseprojects.io:1883'; // URL du broker MQTT
const TOPIC_PISCINE = 'uca/iot/piscine';
const TOPIC_GETCLIENT = "uca/waterbnb/21904810/a50";

// // Se connecter au broker MQTT
const mqttClient = mqtt.connect(mqttBrokerUrl);

let collectionPiscineActivity;
let numberClient = 0;

mqttClient.on('connect', () => {
    console.log('Connecté au broker MQTT');
    mqttClient.subscribe(TOPIC_PISCINE);
    mqttClient.subscribe(TOPIC_GETCLIENT);
});

mqttClient.on('message', (topic, message) => {

    if (topic === TOPIC_PISCINE) {
        const msg = message.toString();

        const data = parseMessage(msg);
        if (data !== null) {
            const ident = data.info.ident;
            if (ident in pools) {
                pools[ident] = { ...pools[ident], ...data };
            } else {
                pools[ident] = data;
            }
        }
    }

    if (topic === TOPIC_GETCLIENT) {
        const msg = message.toString();

        const data = parseMessageClient(msg);
        console.log(data);
        if (data !== null) {
            const tid = data.tid;
            if (tid in users) {
                users[tid] = { ...users[tid], ...data };
            } else {
                users[tid] = data;
            }
        }
    }
});

// Connexion à la base de données MongoDB
mongoose
    .connect('mongodb+srv://WaterBnBAdmin:7OWqnjtNHADwsJXR@waterbnb.p8keb6e.mongodb.net/WaterBnB', {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(() => {
        console.log('Connecté à la base de données MongoDB');

        // Sélectionnez la base de données
        const db = mongoose.connection.db;

        // Accédez à la collection
        collectionPiscineActivity = db.collection('piscineActivity');

        // Démarrage du service web une fois connecté à la base de données
        app.listen(port, () => {
            console.log(`Le service web est en cours d'exécution sur le port ${port}`);
        });
    })
    .catch((error) => {
        console.error('Erreur lors de la connexion à la base de données MongoDB', error);
    });


app.get('/open', (req, res) => {
    const idu = req.query.idu;
    const idswp = req.query.idswp;

    console.log(`Received open request for ${idu} and ${idswp}`);

    if (idswp in pools) {
        console.log(pools[idswp]['info']);

        if (idu in users) {
            const tid = users[idu]['tid'];
            const lat = users[idu]['lat'];
            const lon = users[idu]['lon'];

            console.log(tid);

            console.log(`Latitude: ${lat}, Longitude: ${lon}`);

            const poolLoc = pools[idswp]['info']['loc'];
            const poolLat = poolLoc['lat'];
            const poolLon = poolLoc['lon'];
            const distance = distanceHaversine(lat, lon, poolLat, poolLon);

            console.log("distance : " + distance);

            if (distance < 0.1) {
                const poolIp = pools[idswp]['info']['ip'];
                console.log(poolIp);
                console.log(`Calling ${poolIp}/pool`);
                performPoolRequest(poolIp);
                let color = "Yellow";
                publishClient(tid, lat, lon, color);
                numberClient++;

                saveInDB(idswp, users[idu]['date']);

                setTimeout(() => {
                    performPoolRequest(poolIp);
                }, 30 * 1000);
            } else {
                console.log(`Failed, distance was ${distance}`);
                let color = "Blue";
                publishClient(tid, lat, lon, color);
            }
        }

        res.send('Demande envoyée.\nAssurez-vous que votre géolocalisation soit activée puis patientez...');
    } else {
        res.send('Une erreur est survenue. Veuillez vous assurer que la piscine soit bien connectée, et réessayez.');
    }
});

function performPoolRequest(pool_ip) {
    console.log(`Calling ${pool_ip}/pool`);
    const url = `http://${pool_ip}/pool`;
    axios.get(url);
}


function distanceHaversine(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371; // Rayon de la Terre en kilomètres

    // Conversion des degrés en radians
    const toRadians = (angle) => (angle * Math.PI) / 180;

    // Calcul des différences de latitude et de longitude en radians
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    // Conversion des latitudes en radians
    const radLat1 = toRadians(lat1);
    const radLat2 = toRadians(lat2);

    // Calcul de la formule de l'Haversine
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2) *
        Math.cos(radLat1) *
        Math.cos(radLat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Calcul de la distance en kilomètres
    const distance = earthRadius * c;

    return distance;
}

function parseMessage(message) {
    try {
        const data = JSON.parse(message);
        const ident = data['info']['ident'];
        const temperature = data['status']['temperature'];
        const light = data['status']['light'];
        const ip = data['info']['ip'];
        const lat = data['info']['loc']['lat'];
        const lon = data['info']['loc']['lon'];

        return {
            info: {
                ident: ident,
                ip: ip,
                loc: {
                    lat: lat,
                    lon: lon,
                },
            },
            status: {
                temperature: temperature,
                light: light,
            },
        };
    } catch (error) {
        console.log(`Failed to parse message: ${message}`);
        return null;
    }
}

function parseMessageClient(message) {
    try {
        const data = JSON.parse(message);
        const tid = data['tid'];
        const lat = data['lat'];
        const lon = data['lon'];
        const color = data['iconColor'];
        const date = data['created_at'];

        return {
            tid: tid,
            lat: lat,
            lon: lon,
            iconColor: color,
            date: date,
        };
    } catch (error) {
        console.log(`Failed to parse message: ${message}`);
        return null;
    }
}

function publishClient(tid, lat, lon, color) {
    const clientData = {
        tid: tid,
        lat: lat,
        lon: lon,
        iconColor: color,
    };

    const message = JSON.stringify(clientData);
    mqttClient.publish(TOPIC_GETCLIENT, message);
    console.log('Client data published:', message);
}

// Définition des routes
app.get('/', (req, res) => {
    res.send('Bonjour, bienvenue sur le service web !');
    //saveInDB(data)
});

function saveInDB(namePiscine, dateClient) {
    console.log(namePiscine);
    console.log(convertUnixTimestampWithTime(dateClient));

    const activity = {
        piscine: namePiscine,
        date: convertUnixTimestampWithTime(dateClient),
        clientPresent: numberClient
    };

    collectionPiscineActivity.insertOne(activity)
        .then(() => {
            console.log('Enregistrement ajouté dans la base de données');
        })
        .catch((error) => {
            console.error('Erreur lors de l\'ajout de l\'enregistrement dans la base de données', error);
        });
}


function convertUnixTimestampWithTime(timestamp) {
    const date = new Date(timestamp * 1000); // Convert seconds to milliseconds

    const day = date.getDate();
    const month = date.getMonth() + 1; // Months are zero-based
    const year = date.getFullYear();

    // Pad single-digit day, month, hour, and minute with leading zeros
    const formattedDay = String(day).padStart(2, '0');
    const formattedMonth = String(month).padStart(2, '0');
    const formattedYear = String(year);

    const hours = date.getHours();
    const minutes = date.getMinutes();

    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');

    const formattedDate = `${formattedDay}/${formattedMonth}/${formattedYear} ${formattedHours}:${formattedMinutes}`;

    return formattedDate;
}
