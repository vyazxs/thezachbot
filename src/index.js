import 'dotenv/config';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} from 'discord.js';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  StreamType,
  VoiceConnectionStatus
} from '@discordjs/voice';
import ffmpegPath from 'ffmpeg-static';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import { Readable } from 'node:stream';
import { hasRequiredRole } from './permissions.js';

const config = {
  token: process.env.DISCORD_TOKEN,
  minimumRoleId: process.env.COMMAND_MIN_ROLE_ID ?? '1572455183819087903',
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID ?? '1572447173579243614',
  tiktokUsername: (process.env.TIKTOK_USERNAME ?? '@zachwallace09').replace(/^@/, ''),
  tiktokChannelId: process.env.TIKTOK_NOTIFY_CHANNEL_ID ?? '1572447173579243614',
  tiktokGiftChannelId: process.env.TIKTOK_GIFT_CHANNEL_ID ?? '1572450669275783260'
};

if (!config.token) {
  throw new Error('DISCORD_TOKEN is required. Copy .env.example to .env and configure it.');
}

if (ffmpegPath && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const voiceSessions = new Map();
const PREFIX = '.';
const DINO_GREEN = 0x55c878;

function dinoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(DINO_GREEN)
    .setTitle(`🦖 ${title}`)
    .setDescription(description)
    .setFooter({ text: 'TheZachBot • Dino crew' })
    .setTimestamp();
}

async function sendEmbed(channel, embed) {
  await channel.send({ embeds: [embed] });
}

function splitSpeech(text) {
  const chunks = [];
  let chunk = '';
  for (const token of text.match(/\S+\s*/gu) ?? []) {
    if (chunk && chunk.length + token.length > 180) {
      chunks.push(chunk.trim());
      chunk = '';
    }
    if (token.length > 180) {
      const characters = Array.from(token);
      for (let index = 0; index < characters.length; index += 180) {
        const part = characters.slice(index, index + 180).join('');
        if (index + 180 < characters.length) chunks.push(part);
        else chunk = part;
      }
    } else {
      chunk += token;
    }
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}

async function startSpeaking(session, text) {
  const audioParts = [];
  for (const chunk of splitSpeech(text)) {
    const url = new URL('https://translate.google.com/translate_tts');
    url.search = new URLSearchParams({
      ie: 'UTF-8',
      q: chunk,
      tl: 'en',
      client: 'tw-ob'
    }).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TTS service returned HTTP ${response.status}`);
    }
    audioParts.push(Buffer.from(await response.arrayBuffer()));
  }
  const audio = Buffer.concat(audioParts);
  const resource = createAudioResource(Readable.from(audio), {
    inputType: StreamType.Arbitrary
  });

  session.player.play(resource);
  await entersState(session.player, AudioPlayerStatus.Idle, 60_000);
}

function queueSpeech(session, text) {
  session.queue = session.queue
    .then(() => startSpeaking(session, text))
    .catch((error) => console.error('Unable to speak a voice-channel message:', error));
}

function messageForSpeech(message) {
  return message.content
    .replace(/<@!?(\d+)>/g, (_, id) => message.guild.members.cache.get(id)?.displayName ?? 'someone')
    .replace(/<#[0-9]+>/g, 'a channel')
    .replace(/<@&[0-9]+>/g, 'a role')
    .replace(/https?:\/\/\S+/g, 'link')
    .trim()
    .slice(0, 400);
}

async function joinVoice(message) {
  const channel = message.member.voice.channel;
  if (!channel || !channel.isVoiceBased() || channel.type === ChannelType.GuildStageVoice) {
    await sendEmbed(message.channel, dinoEmbed('Find a voice channel first', 'Join a regular voice channel, then use `.join` again.'));
    return;
  }

  const existing = voiceSessions.get(message.guildId);
  if (existing) {
    existing.connection.destroy();
    voiceSessions.delete(message.guildId);
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: message.guildId,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: false
  });
  const player = createAudioPlayer();
  connection.subscribe(player);
  const session = { connection, player, channelId: channel.id, queue: Promise.resolve() };
  voiceSessions.set(message.guildId, session);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        entersState(connection, VoiceConnectionStatus.Ready, 5_000)
      ]);
    } catch (error) {
      console.error(`Voice connection to ${channel.name} could not recover:`, error);
      if (voiceSessions.get(message.guildId) === session) {
        voiceSessions.delete(message.guildId);
        connection.destroy();
      }
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    voiceSessions.delete(message.guildId);
    connection.destroy();
    throw error;
  }

  await sendEmbed(message.channel, dinoEmbed(
    'Dino DJ is in the cave!',
    `I joined **${channel.name}**. Messages in this voice channel's chat will be read aloud. Use \`.leave\` when you’re done.`
  ));
}

async function handleCommand(message, command, args) {
  const requiredRole = message.guild.roles.cache.get(config.minimumRoleId);
  if (!requiredRole) {
    console.error(`Configured command role ${config.minimumRoleId} was not found in guild ${message.guildId}.`);
    await sendEmbed(message.channel, dinoEmbed('Dino setup needed', 'The command access role is missing from this server. Ask an administrator to check the bot configuration.'));
    return;
  }
  if (!hasRequiredRole(message.member, requiredRole)) {
    await sendEmbed(message.channel, dinoEmbed(
      'This cave is for higher ranks',
      `You need **${requiredRole.name}** or a role above it to use bot commands.`
    ));
    return;
  }

  switch (command) {
    case 'help':
      await sendEmbed(message.channel, dinoEmbed(
        'Dino command cave',
        [
          '`.ban <user ID> [reason]` — ban a user.',
          '`.unban <user ID>` — remove a ban.',
          '`.block <TikTok username>` — TikTok blocks must be managed by a live moderator.',
          '`.join` — join your voice channel and read its chat aloud.',
          '`.leave` — leave voice chat.'
        ].join('\n')
      ));
      break;
    case 'ban': {
      const [userId, ...reasonParts] = args;
      if (!/^\d{17,20}$/.test(userId ?? '')) {
        await sendEmbed(message.channel, dinoEmbed('Missing user ID', 'Use `.ban <user ID> [reason]`.'));
        return;
      }
      if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await sendEmbed(message.channel, dinoEmbed('I need a stronger claw', 'Give the bot the **Ban Members** permission, then try again.'));
        return;
      }
      const reason = reasonParts.join(' ').slice(0, 500) || `Banned by ${message.author.tag}`;
      await message.guild.members.ban(userId, { reason });
      await sendEmbed(message.channel, dinoEmbed('Ban complete', `User \`${userId}\` was banned.\n**Reason:** ${reason}`));
      break;
    }
    case 'unban': {
      const [userId] = args;
      if (!/^\d{17,20}$/.test(userId ?? '')) {
        await sendEmbed(message.channel, dinoEmbed('Missing user ID', 'Use `.unban <user ID>`.'));
        return;
      }
      if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
        await sendEmbed(message.channel, dinoEmbed('I need a stronger claw', 'Give the bot the **Ban Members** permission, then try again.'));
        return;
      }
      await message.guild.bans.remove(userId, `Unbanned by ${message.author.tag}`);
      await sendEmbed(message.channel, dinoEmbed('Ban lifted', `User \`${userId}\` can rejoin the dino crew.`));
      break;
    }
    case 'block': {
      const username = args[0]?.replace(/^@/, '');
      if (!username || !/^[\w.]{2,24}$/.test(username)) {
        await sendEmbed(message.channel, dinoEmbed('TikTok username needed', 'Use `.block <TikTok username>`.'));
        return;
      }
      await sendEmbed(message.channel, dinoEmbed(
        'TikTok moderation is unavailable',
        `I can’t block **@${username}** on TikTok. This bot’s TikTok connection is read-only; a LIVE moderator must block the user using TikTok’s moderation tools.`
      ));
      break;
    }
    case 'join':
      await joinVoice(message);
      break;
    case 'leave': {
      const session = voiceSessions.get(message.guildId);
      if (!session) {
        await sendEmbed(message.channel, dinoEmbed('Already out exploring', 'I’m not connected to a voice channel right now.'));
        return;
      }
      session.connection.destroy();
      voiceSessions.delete(message.guildId);
      await sendEmbed(message.channel, dinoEmbed('Dino DJ signing off', 'I left the voice channel.'));
      break;
    }
    default:
      await sendEmbed(message.channel, dinoEmbed('Unknown command', 'Use `.help` to see the dino commands.'));
  }
}

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;

  if (message.channel.type === ChannelType.GuildVoice && !message.content.startsWith(PREFIX)) {
    const session = voiceSessions.get(message.guildId);
    if (session?.channelId === message.channelId) {
      const text = messageForSpeech(message);
      if (text) queueSpeech(session, text);
    }
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;
  const [command = '', ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  try {
    await handleCommand(message, command.toLowerCase(), args);
  } catch (error) {
    console.error(`Command .${command} failed:`, error);
    await sendEmbed(message.channel, dinoEmbed('That didn’t go as planned', 'The command failed. Check the bot logs or its server permissions and try again.')).catch((sendError) => {
      console.error('Unable to send command error response:', sendError);
    });
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const welcome = dinoEmbed(
    'A new dino joined the crew!',
    `Welcome to **${member.guild.name}**, ${member}! 🦕\nMake yourself at home and have a great time!`
  ).setThumbnail(member.user.displayAvatarURL({ size: 256 }));

  const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch((error) => {
    console.error(`Unable to fetch welcome channel ${config.welcomeChannelId}:`, error);
    return null;
  });
  if (channel?.isTextBased()) {
    await sendEmbed(channel, welcome).catch((error) => console.error('Unable to post welcome message:', error));
  } else {
    console.error(`Welcome channel ${config.welcomeChannelId} is missing or is not a text channel.`);
  }

  await member.send({ embeds: [dinoEmbed(
    `Welcome to ${member.guild.name}!`,
    'You’re officially part of the dino crew. Check out the server and say hi!'
  ).setThumbnail(member.user.displayAvatarURL({ size: 256 }))] }).catch((error) => {
    console.warn(`Could not DM new member ${member.id}; their DMs may be closed.`, error.message);
  });
});

async function checkTikTokLive(connection, wasLive) {
  try {
    const isLive = await connection.fetchIsLive();
    if (isLive && !wasLive) {
      const channel = await client.channels.fetch(config.tiktokChannelId);
      if (!channel?.isTextBased()) {
        throw new Error(`TikTok notification channel ${config.tiktokChannelId} is missing or is not text-based.`);
      }
      await sendEmbed(channel, dinoEmbed(
        'Zach is LIVE on TikTok!',
        `Jump into the stream and say hi! 🦖\nhttps://www.tiktok.com/@${config.tiktokUsername}/live`
      ));
    }
    return isLive;
  } catch (error) {
    console.error('TikTok live check failed; the next check will retry:', error);
    return wasLive;
  }
}

async function sendTikTokGift(gift) {
  if (gift.giftDetails?.giftType === 1 && gift.repeatEnd !== true) return;

  const channel = await client.channels.fetch(config.tiktokGiftChannelId);
  if (!channel?.isTextBased()) {
    throw new Error(`TikTok gift channel ${config.tiktokGiftChannelId} is missing or is not text-based.`);
  }

  const user = gift.user;
  const giftName = gift.giftDetails?.giftName ?? `Gift #${gift.giftId ?? 'unknown'}`;
  const quantity = Math.max(1, Number(gift.repeatCount) || 1);
  const diamondCount = Number(gift.diamondCount ?? gift.giftDetails?.diamondCount);
  const username = user?.uniqueId ?? user?.nickname ?? 'A viewer';
  const embed = new EmbedBuilder()
    .setColor(0xFE2C55)
    .setTitle('🎁 A gift just landed on the LIVE!')
    .setDescription(`**${username}** sent **${giftName}**${quantity > 1 ? ` ×${quantity}` : ''} to **@${config.tiktokUsername}**! 🦖`)
    .addFields(
      { name: '🎁 Gift', value: String(giftName).slice(0, 100), inline: true },
      { name: '🔢 Quantity', value: String(quantity), inline: true },
      {
        name: '💎 Diamonds',
        value: Number.isFinite(diamondCount) && diamondCount > 0
          ? String(diamondCount * quantity)
          : '—',
        inline: true
      }
    )
    .setFooter({ text: `TikTok LIVE • @${config.tiktokUsername}` })
    .setTimestamp();

  const image = gift.giftPictureUrl ?? gift.giftDetails?.giftImage?.url?.[0];
  if (typeof image === 'string' && /^https:\/\/\S+$/i.test(image)) {
    embed.setThumbnail(image);
  }

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  const tiktok = new TikTokLiveConnection(config.tiktokUsername, {});
  tiktok.on(WebcastEvent.GIFT, (gift) => {
    void sendTikTokGift(gift).catch((error) => {
      console.error('Unable to post TikTok gift notification:', error);
    });
  });
  tiktok.on(WebcastEvent.STREAM_END, () => {
    void tiktok.disconnect().catch((error) => {
      console.error('Unable to disconnect from ended TikTok LIVE:', error);
    });
  });

  let wasLive = false;
  let pollInProgress = false;
  const poll = async () => {
    if (pollInProgress) return;
    pollInProgress = true;
    try {
      wasLive = await checkTikTokLive(tiktok, wasLive);
      if (wasLive && !tiktok.isConnected && !tiktok.isConnecting) {
        await tiktok.connect();
        console.log(`Connected to @${config.tiktokUsername}'s TikTok LIVE for gift events.`);
      } else if (!wasLive && tiktok.isConnected) {
        await tiktok.disconnect();
      }
    } catch (error) {
      console.error('TikTok LIVE connection failed; the next check will retry:', error);
    } finally {
      pollInProgress = false;
    }
  };
  await poll();
  const timer = setInterval(poll, 30_000);
  timer.unref();
});

client.login(config.token).catch((error) => {
  console.error('Failed to log in to Discord:', error);
  process.exitCode = 1;
});
