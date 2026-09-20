/**
 * URA de consulta de tonelagem e ATR para fornecedores de cana
 * Fluxo: fornecedor manda o CPF -> bot valida -> mostra menu -> responde com os dados
 *
 * O QR Code de conexão é exibido em uma página web (public/index.html),
 * em vez do terminal.
 *
 * Dependências:
 *   npm install @whiskeysockets/baileys @hapi/boom express qrcode
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const PORTA = process.env.PORT || 3000;

// ---------- Estado da conexão (usado pela página web) ----------
let qrCodeAtual = null;      // QR Code em formato data URL (imagem), ou null
let statusConexao = 'aguardando'; // 'aguardando' | 'conectado' | 'desconectado'

// ---------- Servidor web (mostra o QR Code em /) ----------
function iniciarServidor() {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/status', (req, res) => {
    res.json({ status: statusConexao, qr: qrCodeAtual });
  });

  app.listen(PORTA, () => {
    console.log(`🌐 Acesse http://localhost:${PORTA} para escanear o QR Code`);
  });
}

// ---------- "Banco de dados" (trocar depois por planilha/SQL) ----------
const CAMINHO_DADOS = path.join(__dirname, 'dados-fornecedores.json');
function carregarDados() {
  return JSON.parse(fs.readFileSync(CAMINHO_DADOS, 'utf-8'));
}

// ---------- Estado de sessão por número (em memória) ----------
// Em produção, trocar por Redis ou banco, para sobreviver a restart do bot
const sessoes = new Map();

function getSessao(numero) {
  if (!sessoes.has(numero)) {
    sessoes.set(numero, { etapa: 'inicio', cpf: null });
  }
  return sessoes.get(numero);
}

function limparCPF(texto) {
  return texto.replace(/\D/g, ''); // remove pontuação, deixa só números
}

function formatarData(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

function montarBoasVindas() {
  return `👋 Olá! Bem-vindo à Central de Consulta da Usina.\n\n` +
    `Por aqui você pode consultar:\n` +
    `🚛 Sua última entrega (tonelagem e ATR)\n` +
    `📊 O acumulado da sua safra\n\n` +
    `Para começar, digite o número do seu CPF (somente números).`;
}

function montarMenu(nome) {
  return `Olá, ${nome}! 👋\nO que você deseja consultar?\n\n` +
    `1️⃣ Última entrega\n` +
    `2️⃣ Acumulado da safra\n\n` +
    `Digite o número da opção.`;
}

function montarUltimaEntrega(fornecedor) {
  const ultima = fornecedor.entregas[0];
  return `📋 Fornecedor: ${fornecedor.nome} (Cód. ${fornecedor.codigo})\n` +
    `📅 Última entrega: ${formatarData(ultima.data)}\n` +
    `🚛 Tonelagem: ${ultima.toneladas.toFixed(3)} t\n` +
    `🧪 ATR: ${ultima.atr.toFixed(2)} kg/t`;
}

function montarAcumuladoSafra(fornecedor) {
  const totalToneladas = fornecedor.entregas.reduce((soma, e) => soma + e.toneladas, 0);
  const mediaATR = fornecedor.entregas.reduce((soma, e) => soma + e.atr, 0) / fornecedor.entregas.length;
  return `📊 Fornecedor: ${fornecedor.nome} (Cód. ${fornecedor.codigo})\n` +
    `🚛 Total entregue na safra: ${totalToneladas.toFixed(3)} t\n` +
    `🧪 ATR médio: ${mediaATR.toFixed(2)} kg/t\n` +
    `📦 Nº de entregas registradas: ${fornecedor.entregas.length}`;
}

// ---------- Processamento da mensagem recebida ----------
async function processarMensagem(sock, numero, textoRecebido) {
  const dados = carregarDados();
  const sessao = getSessao(numero);
  const texto = textoRecebido.trim();

  const enviar = (msg) => sock.sendMessage(numero, { text: msg });

  // Etapa 0: primeira mensagem — mostra as opções e só depois pede o CPF
  if (sessao.etapa === 'inicio') {
    await enviar(montarBoasVindas());
    sessao.etapa = 'aguardando_cpf';
    return;
  }

  // Etapa 1: aguardando CPF
  if (sessao.etapa === 'aguardando_cpf') {
    const cpf = limparCPF(texto);

    if (cpf.length !== 11) {
      await enviar('❗ CPF inválido. Digite apenas os números do seu CPF (11 dígitos).');
      return;
    }

    const fornecedor = dados[cpf];
    if (!fornecedor) {
      await enviar('❗ CPF não encontrado em nosso cadastro. Confira o número ou fale com o atendimento.');
      return; // continua pedindo CPF
    }

    sessao.cpf = cpf;
    sessao.etapa = 'menu';
    await enviar(montarMenu(fornecedor.nome));
    return;
  }

  // Etapa 2: menu de opções
  if (sessao.etapa === 'menu') {
    const fornecedor = dados[sessao.cpf];

    switch (texto) {
      case '1':
        await enviar(montarUltimaEntrega(fornecedor));
        await enviar('Digite "menu" para ver as opções novamente.');
        break;
      case '2':
        await enviar(montarAcumuladoSafra(fornecedor));
        await enviar('Digite "menu" para ver as opções novamente.');
        break;
      case 'menu':
        await enviar(montarMenu(fornecedor.nome));
        break;
      default:
        await enviar('Não entendi. Digite 1 ou 2.');
    }
    return;
  }
}

// ---------- Conexão com o WhatsApp ----------
async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));

  const sock = makeWASocket({
    auth: state
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeAtual = await QRCode.toDataURL(qr);
      statusConexao = 'aguardando';
      console.log('📱 Novo QR Code gerado — acesse a página web para escanear.');
    }

    if (connection === 'close') {
      statusConexao = 'desconectado';
      qrCodeAtual = null;
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const deveReconectar = motivo !== DisconnectReason.loggedOut;
      console.log('Conexão fechada. Reconectar?', deveReconectar);
      if (deveReconectar) iniciarBot();
    } else if (connection === 'open') {
      statusConexao = 'conectado';
      qrCodeAtual = null;
      console.log('✅ Bot conectado ao WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const numero = msg.key.remoteJid;
    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (!texto) return;

    try {
      await processarMensagem(sock, numero, texto);
    } catch (erro) {
      console.error('Erro ao processar mensagem:', erro);
      await sock.sendMessage(numero, { text: '⚠️ Ocorreu um erro. Tente novamente em instantes.' });
    }
  });
}

iniciarServidor();
iniciarBot();
