'use strict';

const amqplib = require('amqplib');
const debug = require('debug')('log4js:rabbitmq');

function rabbitmqAppender(config, layout) {
  const host = config.host || '127.0.0.1';
  const port = config.port || 5672;
  const username = config.username || 'guest';
  const password = config.password || 'guest';
  const exchange = config.exchange || 'log';
  const type = config.mq_type || 'direct';
  const connectDelay = config.connect_delay || 0;
  const durable = config.durable || false;
  const routingKey = config.routing_key || 'logstash';
  const vhost = config.vhost || '/';
  const shutdownTimeout = config.shutdownTimeout || 10000;
  const con = {
    protocol: 'amqp',
    host: host,
    hostname: host,
    port: port,
    username: username,
    password: password,
    locale: 'en_US',
    frameMax: 0,
    heartbeat: 0,
    vhost: vhost,
    routing_key: routingKey,
    exchange: exchange,
    mq_type: type,
    durable: durable,
  };
  const messagesToSend = [];
  let waitingToConnect = true;
  let connection;
  let channel;

  console.log("Use mq appender");

  const send = (messages) => {
    if (!channel) {
      return;
    }
    messages.forEach((message) => {
      debug('Sending message.');
      channel.publish(exchange, routingKey, Buffer.from(message));
    });
    messages.length = 0;
  };

  const publish = (message) => {
    if (message) {
      messagesToSend.push(message);
      debug(`Added message to buffer. Buffer length: ${messagesToSend.length}`);
    }
    if (!channel) {
      connect();
    }
    if (!waitingToConnect && connection && channel && messagesToSend.length > 0) {
      debug('Sending buffer.');
      send(messagesToSend);
    }
  };

  const closeConnection = (done) => {
    if (connection) {
      connection.close().then(done);
      return;
    }
    done();
  };

  const waiting = () => waitingToConnect || messagesToSend.length > 0;

  const waitForPromises = (done) => {
    let howLongWaiting = 0;
    const checker = () => {
      debug(`waitingToConnect? ${waitingToConnect}`);
      publish();
      if (howLongWaiting >= shutdownTimeout) {
        debug(`Done waiting for promises. Waiting: ${messagesToSend.length}`);
        closeConnection(done);
        return;
      }
      if (waiting()) {
        debug('Things to wait for.');
        howLongWaiting += 50;
        setTimeout(checker, 50);
      } else {
        debug('Nothing to wait for, shutdown now.');
        closeConnection(done);
      }
    };
    checker();
  };

  const connect = () => {
    if(channel){
      return;
    }
    debug('Connecting...');
    setTimeout(() => {
      let tempChannel = undefined;
      amqplib.connect(con).then((c) => {
        connection = c;
        waitingToConnect = false;
        debug('Connected.');
        return c.createChannel()
      }).then((ch) => {
        tempChannel = ch;
        return ch.assertExchange(exchange, type, { durable: durable });
      }).then(() => {
        channel = tempChannel;
        publish();
      }).catch((e) => {
        debug('connect failed.');
        waitingToConnect = false;
        console.error(e); // eslint-disable-line
      });
    }, connectDelay);
  }

  connect();

  const appender = loggingEvent => publish(layout(loggingEvent));

  appender.shutdown = function (done) {
    debug('Appender shutdown.');
    debug(`waitingToConnect: ${waitingToConnect},
      messagesToSend: ${messagesToSend}`);
    channel && channel.close();
    waitForPromises(done);
  };
  return appender;
}

function configure(config, layouts) {
  let layout = layouts.messagePassThroughLayout;
  if (config.layout) {
    layout = layouts.layout(config.layout.type, config.layout);
  }

  return rabbitmqAppender(config, layout);
}

module.exports.configure = configure;
