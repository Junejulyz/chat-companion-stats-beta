import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "chat-companion-stats";
const extensionWebPath = import.meta.url.replace(/\/index\.js$/, '');
const DEBUG = false;

jQuery(async () => {
  // 加载CSS文件 using dynamic path
  $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionWebPath}/styles.css">`);

  // 加载HTML using dynamic path
  const settingsHtml = await $.get(`${extensionWebPath}/settings.html`);
  $("#extensions_settings").append(settingsHtml);

  // 确保模态框初始状态是隐藏的
  $("#ccs-preview-modal").hide();

  function getCurrentCharacterName() {
    // 从聊天消息中获取非用户消息的 ch_name
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (!isUser) {
        const chName = msg.getAttribute('ch_name');
        if (chName) return chName;
      }
    }

    // 备用方法：从选中的角色按钮获取
    const selectedChar = document.querySelector('#rm_button_selected_ch h2');
    if (selectedChar?.textContent) {
      return selectedChar.textContent.trim();
    }

    return "未知角色";
  }

  // Helper function to parse SillyTavern's date format more reliably
  // Use both full month names and 3-letter abbreviations
  const monthMap = {
    Jan: '01', January: '01',
    Feb: '02', February: '02',
    Mar: '03', March: '03',
    Apr: '04', April: '04',
    May: '05', May: '05',
    Jun: '06', June: '06',
    Jul: '07', July: '07',
    Aug: '08', August: '08',
    Sep: '09', September: '09',
    Oct: '10', October: '10',
    Nov: '11', November: '11',
    Dec: '12', December: '12'
  };

  function parseSillyTavernDate(dateString) {
    if (DEBUG) console.log(`Attempting to parse date: "${dateString}"`);
    if (!dateString) {
      if (DEBUG) console.log("Date string is empty, returning null.");
      return null;
    }

    // Try parsing the specific format "Month Day, Year HH:MMam/pm"
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (DEBUG) console.log("Regex match result (parts):", parts);
    if (parts) {
      console.log("Regex matched specific format.");
      const monthName = parts[1];
      const day = parts[2];
      const year = parts[3];
      let hour = parseInt(parts[4], 10);
      const minute = parts[5];
      const ampm = parts[6].toLowerCase();
      if (DEBUG) console.log(`Parsed parts: Month=${monthName}, Day=${day}, Year=${year}, Hour=${hour}, Minute=${minute}, AMPM=${ampm}`);

      const monthNumber = monthMap[monthName];
      if (!monthNumber) {
        if (DEBUG) console.warn(`Unknown month name "${monthName}" in date string: ${dateString}`);
        return null;
      }
      if (DEBUG) console.log(`Month number: ${monthNumber}`);

      if (ampm === 'pm' && hour !== 12) {
        hour += 12;
        if (DEBUG) console.log(`Adjusted hour for PM: ${hour}`);
      } else if (ampm === 'am' && hour === 12) {
        hour = 0;
        if (DEBUG) console.log(`Adjusted hour for 12 AM: ${hour}`);
      }

      // Construct an ISO-like string that new Date() handles reliably
      const isoLikeString = `${year}-${monthNumber}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00`;
      if (DEBUG) console.log(`Constructed ISO-like string: ${isoLikeString}`);
      const date = new Date(isoLikeString);
      if (DEBUG) console.log(`Result of new Date(isoLikeString): ${date}`);
      const isValid = date && !isNaN(date.getTime());
      if (DEBUG) console.log(`Is parsed date valid? ${isValid}`);
      return isValid ? date : null;
    }

    if (DEBUG) console.log("Regex did not match specific format, trying fallback.");
    // Fallback: Try direct parsing for other potential formats
    const fallbackDate = new Date(dateString);
    if (DEBUG) console.log(`Result of fallback new Date(dateString): ${fallbackDate}`);
    const isFallbackValid = fallbackDate && !isNaN(fallbackDate.getTime());
    if (DEBUG) console.log(`Is fallback date valid? ${isFallbackValid}`);
    return isFallbackValid ? fallbackDate : null;
  }

  // 从文件名解析时间
  function parseTimeFromFilename(filename) {
    // 从文件名中提取日期和时间
    const match = filename.match(/(\d{4}-\d{2}-\d{2})@(\d{2})h(\d{2})m(\d{2})s/);
    if (match) {
      const [_, date, hours, minutes, seconds] = match;
      const totalSeconds = parseInt(hours, 10) * 3600 + parseInt(minutes, 10) * 60 + parseInt(seconds, 10);

      // 构建日期对象 (注意：Date.parse 也支持 YYYY-MM-DDTHH:mm:ss 格式)
      const dateObject = new Date(`${date}T${hours}:${minutes}:${seconds}`);

      return {
        date,
        time: `${hours}:${minutes}:${seconds}`,
        fullDateTime: `${date} ${hours}:${minutes}:${seconds}`,
        totalSeconds,
        dateObject: !isNaN(dateObject.getTime()) ? dateObject : null
      };
    }
    return null;
  }

  // 格式化日期时间
  function formatDateTime(dateTimeString) {
    if (!dateTimeString) return "未知时间";
    const date = new Date(dateTimeString);
    if (isNaN(date.getTime())) return "未知时间";

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${year}年${month}月${day}日 ${hours}点${minutes}分`;
  }

  // 格式化时长
  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  // 计算消息的字数 (核心过滤逻辑)
  function countWordsInMessage(message) {
    if (!message) return 0;

    let text = message;

    // 1. 深度正则过滤 (使用制作人排除法)
    try {
      // - 排除 think/thinking 块 (处理已完成和未完成的)
      text = text.replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, '');

      // - 排除元数据标签及其中间内容
      text = text.replace(/\[finire\]/gi, '');
      text = text.replace(/<(finish|disclaimer)>[\s\S]*?(<\/\1>|$)/gi, '');

      // - 排除 HTML 注释 (包括 draft/confirm)
      text = text.replace(/<!--[\s\S]*?-->/g, '');

      // - 排除特定的系统/UI标签如 <DH_...>, <FH_...>
      text = text.replace(/<(DH|FH)_[^>]*>/gi, '');

      // - 排除特定的样式标记 (处理可能的兼容性)
      text = text.replace(/<p style[^>]*>/gi, '');
    } catch (reError) {
      if (DEBUG) console.warn('Regex filtering failed for a message:', reError);
    }

    // - 移除所有剩余的 HTML 标签
    text = text.replace(/<[^>]*>/g, '');

    // 2. 统计处理
    // 中/日/韩文字符
    const cjkChars = text.match(/[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g) || [];
    // 英文单词/拉丁单词
    const latinWords = text.match(/[a-zA-Z0-9]+/g) || [];

    return cjkChars.length + latinWords.length;
  }

  // 获取当前聊天的字数统计和大小
  function getCurrentChatStats() {
    const messages = document.querySelectorAll('#chat .mes');
    let userWords = 0, userSize = 0, userCount = 0;
    let charWords = 0, charSize = 0, charCount = 0;
    let userChineseRatio = 0, userEnglishRatio = 0;
    let charChineseRatio = 0, charEnglishRatio = 0;

    messages.forEach(message => {
      const content = message.querySelector('.mes_text')?.textContent || '';
      const isUser = message.getAttribute('is_user') === 'true';
      const words = countWordsInMessage(content);

      // 计算中英文比例
      const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = content.match(/[a-zA-Z0-9]+/g) || [];
      const totalChars = chineseChars.length + englishWords.length;

      if (totalChars > 0) {
        const chineseRatio = chineseChars.length / totalChars;
        const englishRatio = englishWords.length / totalChars;

        if (isUser) {
          userChineseRatio += chineseRatio;
          userEnglishRatio += englishRatio;
        } else {
          charChineseRatio += chineseRatio;
          charEnglishRatio += englishRatio;
        }
      }

      const messageData = {
        content,
        is_user: isUser,
        ch_name: message.getAttribute('ch_name') || '',
        send_date: message.getAttribute('send_date') || ''
      };
      const messageSize = JSON.stringify(messageData).length + 2; // 加换行

      if (isUser) {
        userWords += words;
        userSize += messageSize;
        userCount++;
      } else {
        charWords += words;
        charSize += messageSize;
        charCount++;
      }
    });

    // 计算平均中英文比例
    if (userCount > 0) {
      userChineseRatio /= userCount;
      userEnglishRatio /= userCount;
    }
    if (charCount > 0) {
      charChineseRatio /= charCount;
      charEnglishRatio /= charCount;
    }

    return {
      user: {
        words: userWords,
        size: userSize,
        count: userCount,
        chineseRatio: userChineseRatio,
        englishRatio: userEnglishRatio
      },
      char: {
        words: charWords,
        size: charSize,
        count: charCount,
        chineseRatio: charChineseRatio,
        englishRatio: charEnglishRatio
      }
    };
  }

  // 构建针对特定路径的 fetch 请求
  async function fetchChatFile(path) {
    try {
      if (DEBUG) console.log(`Attempting fetch: ${path}`);
      const response = await fetch(path, { credentials: 'same-origin' });
      if (response.ok) {
        return await response.text();
      }
      if (DEBUG) console.warn(`Fetch failed for ${path}: ${response.status}`);
    } catch (e) {
      if (DEBUG) console.error(`Fetch error for ${path}:`, e);
    }
    return null;
  }

  // 获取单个聊天文件的统计数据 (带有路径回退逻辑)
  async function getChatFileStats(fileName) {
    const context = getContext();
    const charId = context.characterId;
    const encodedFileName = encodeURIComponent(fileName);
    let text = null;

    // 尝试方式 1: 基于 characterId (头像文件名)
    if (charId && typeof charId === 'string' && charId !== '0') {
      const lastDotIndex = charId.lastIndexOf('.');
      const folderName = lastDotIndex > 0 ? charId.substring(0, lastDotIndex) : charId;
      text = await fetchChatFile(`/chats/${folderName}/${encodedFileName}`);
    }

    // 尝试方式 2: 基于角色名 (从文件名解析)
    if (!text) {
      const characterName = fileName.split(' - ')[0];
      text = await fetchChatFile(`/chats/${encodeURIComponent(characterName)}/${encodedFileName}`);
    }

    if (!text) return { words: 0, count: 0 };

    try {
      const lines = text.trim().split('\n').filter(l => l.trim());
      let totalWords = 0;
      let validMessages = 0;
      let earliestTimeInFile = null;

      lines.forEach(line => {
        try {
          const m = JSON.parse(line);
          // 确保是有效的消息对象
          if (m && (m.mes !== undefined || m.is_user !== undefined)) {
            totalWords += countWordsInMessage(m.mes || '');
            validMessages++;

            // 提取该文件的最早时间
            if (m.send_date) {
              const msgDate = parseSillyTavernDate(m.send_date);
              if (msgDate && (!earliestTimeInFile || msgDate < earliestTimeInFile)) {
                earliestTimeInFile = msgDate;
              }
            }
          }
        } catch (e) { }
      });

      return {
        words: totalWords,
        count: validMessages,
        earliestTime: earliestTimeInFile
      };
    } catch (e) {
      if (DEBUG) console.error(`Parsing error for chat ${fileName}:`, e);
      return { words: 0, count: 0, earliestTime: null };
    }
  }

  // 从消息数据中获取统计信息
  function getStatsFromMessages(messages) {
    let userWords = 0, userSize = 0, userCount = 0;
    let charWords = 0, charSize = 0, charCount = 0;
    let userChineseRatio = 0, userEnglishRatio = 0;
    let charChineseRatio = 0, charEnglishRatio = 0;

    messages.forEach(message => {
      const content = message.mes || '';
      const isUser = message.is_user;
      const words = countWordsInMessage(content);

      // 计算中英文比例
      const chineseChars = content.match(/[\u4e00-\u9fff]/g) || [];
      const englishWords = content.match(/[a-zA-Z0-9]+/g) || [];
      const totalChars = chineseChars.length + englishWords.length;

      if (totalChars > 0) {
        const chineseRatio = chineseChars.length / totalChars;
        const englishRatio = englishWords.length / totalChars;

        if (isUser) {
          userChineseRatio += chineseRatio;
          userEnglishRatio += englishRatio;
        } else {
          charChineseRatio += chineseRatio;
          charEnglishRatio += englishRatio;
        }
      }

      const messageData = {
        content,
        is_user: isUser,
        ch_name: message.ch_name || '',
        send_date: message.send_date || ''
      };
      const messageSize = JSON.stringify(messageData).length + 2;

      if (isUser) {
        userWords += words;
        userSize += messageSize;
        userCount++;
      } else {
        charWords += words;
        charSize += messageSize;
        charCount++;
      }
    });

    // 计算平均中英文比例
    if (userCount > 0) {
      userChineseRatio /= userCount;
      userEnglishRatio /= userCount;
    }
    if (charCount > 0) {
      charChineseRatio /= charCount;
      charEnglishRatio /= charCount;
    }

    return {
      user: {
        words: userWords,
        size: userSize,
        count: userCount,
        chineseRatio: userChineseRatio,
        englishRatio: userEnglishRatio
      },
      char: {
        words: charWords,
        size: charSize,
        count: charCount,
        chineseRatio: charChineseRatio,
        englishRatio: charEnglishRatio
      }
    };
  }

  // 获取完整的统计数据
  async function getFullStats() {
    const context = getContext();
    // 兼容不同版本的 SillyTavern 字段名
    let characterId = context.characterId || context.character_id;

    if (DEBUG) console.log('Current Context:', context);

    if (!characterId) {
      if (DEBUG) console.log('未从 context 找到角色ID, 尝试从 DOM/全局变量获取');
      // 尝试从全局变量获取 (SillyTavern 常用变量)
      if (typeof window.selected_character !== 'undefined' && window.characters && window.characters[window.selected_character]) {
        characterId = window.characters[window.selected_character].avatar;
      }
    }

    if (!characterId) {
      if (DEBUG) console.log('仍然未找到当前角色ID');
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0,
        chatFilesCount: 0
      };
    }

    try {
      const chats = await getPastCharacterChats(characterId);
      if (DEBUG) console.log(`获取到 ${characterId} 的聊天记录:`, chats);

      let totalMessagesFromChats = 0;
      let totalSizeKB = 0;
      let earliestTime = null;
      let totalDurationSeconds = 0;
      let totalSizeBytesRaw = 0;
      const chatFilesCount = Array.isArray(chats) ? chats.length : 0;

      if (chatFilesCount === 0) {
        if (DEBUG) console.log('该角色尚无历史聊天记录');
        return {
          messageCount: 0,
          wordCount: 0,
          firstTime: null,
          totalDuration: 0,
          totalSizeBytes: 0,
          chatFilesCount: 0
        };
      }

      chats.forEach(chat => {
        // 使用元数据作为基础值
        totalMessagesFromChats += parseInt(chat.chat_items) || 0;

        // 解析文件大小
        const sizeMatchKB = chat.file_size?.match(/([\d.]+)\s*KB/i);
        const sizeMatchMB = chat.file_size?.match(/([\d.]+)\s*MB/i);
        const sizeAsNumber = parseFloat(chat.file_size);

        if (sizeMatchMB) {
          totalSizeBytesRaw += parseFloat(sizeMatchMB[1]) * 1024 * 1024;
          totalSizeKB += parseFloat(sizeMatchMB[1]) * 1024;
        } else if (sizeMatchKB) {
          totalSizeBytesRaw += parseFloat(sizeMatchKB[1]) * 1024;
          totalSizeKB += parseFloat(sizeMatchKB[1]);
        } else if (!isNaN(sizeAsNumber)) {
          totalSizeBytesRaw += sizeAsNumber;
          totalSizeKB += sizeAsNumber / 1024;
        }

        // 积累时长 & 获取文件名作为初遇时间的参考（通常是文件创建时间）
        if (chat.file_name) {
          const timeInfo = parseTimeFromFilename(chat.file_name);
          if (timeInfo) {
            totalDurationSeconds += timeInfo.totalSeconds;
            // 文件名中的日期通常是该聊天的创建日期，很有参考价值
            if (timeInfo.dateObject && (!earliestTime || timeInfo.dateObject < earliestTime)) {
              earliestTime = timeInfo.dateObject;
              if (DEBUG) console.log('Based on filename, updated earliestTime to:', earliestTime);
            }
          }
        }

        // 解析初遇时间 (作为保底，metadata 通常记录的是文件的最后一条消息时间)
        if (chat.last_mes) {
          const date = parseSillyTavernDate(chat.last_mes);
          if (date && (!earliestTime || date < earliestTime)) {
            // 只有在没更好的数据时才用这个，或者这个确实更早
            earliestTime = date;
          }
        }
      });

      // 默认先使用估算值 (密度取 32.5)
      let estimatedWords = Math.round(totalSizeKB * 32.5);

      // 尝试进行真实全量统计
      try {
        let totalWordsCalculated = 0;
        let totalMessagesCalculated = 0;
        let successCount = 0;

        const batchSize = 10;
        for (let i = 0; i < chats.length; i += batchSize) {
          const batch = chats.slice(i, i + batchSize);
          const results = await Promise.all(batch.map(chat => getChatFileStats(chat.file_name)));

          results.forEach(res => {
            if (res.count > 0 || res.words > 0) {
              totalWordsCalculated += res.words;
              totalMessagesCalculated += res.count;
              successCount++;

              // 寻找绝对最早的初遇时间
              if (res.earliestTime && (!earliestTime || res.earliestTime < earliestTime)) {
                earliestTime = res.earliestTime;
              }
            }
          });
        }

        // 如果成功获取到了任何实际数据，则覆盖元数据估值
        if (successCount > 0) {
          estimatedWords = totalWordsCalculated;
          totalMessagesFromChats = totalMessagesCalculated;
          if (DEBUG) console.log(`全量真实统计覆盖成功: ${totalWordsCalculated} 字`);
        } else {
          if (DEBUG) console.warn('全量读取失败或无有效内容，保持元数据估算值');
        }
      } catch (sumError) {
        if (DEBUG) console.error('全量统计过程出错:', sumError);
      }

      // 如果没有任何消息，直接返回 0 状态
      if (totalMessagesFromChats === 0) {
        return {
          messageCount: 0,
          wordCount: 0,
          firstTime: earliestTime,
          totalDuration: totalDurationSeconds,
          totalSizeBytes: totalSizeBytesRaw,
          chatFilesCount
        };
      }

      return {
        messageCount: totalMessagesFromChats,
        wordCount: estimatedWords,
        firstTime: earliestTime,
        totalDuration: totalDurationSeconds,
        totalSizeBytes: totalSizeBytesRaw,
        chatFilesCount
      };
    } catch (error) {
      if (DEBUG) console.error('getFullStats 运行出错:', error);
      return {
        messageCount: 0,
        wordCount: 0,
        firstTime: null,
        totalDuration: 0,
        totalSizeBytes: 0,
        chatFilesCount: 0
      };
    }
  }



  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // 添加控制分享按钮状态的函数 (优先处理无互动状态)
  function updateShareButtonState(messageCount) {
    const $shareButton = $("#ccs-share");

    // Priority Check: Disable if total message count is 1 or less
    if (messageCount <= 1) {
      $shareButton.prop('disabled', true).val('尚未互动');
      if (DEBUG) console.log('updateShareButtonState: Disabled (messageCount <= 1)');
      return;
    }

    // If interaction exists (messageCount > 1), check if options are selected
    const anyOptionChecked = $('.ccs-share-option input[type="checkbox"]:checked').length > 0;

    if (anyOptionChecked) {
      $shareButton.prop('disabled', false).val('分享');
      if (DEBUG) console.log('updateShareButtonState: Enabled (options checked)');
    } else {
      $shareButton.prop('disabled', true).val('请选择内容');
      if (DEBUG) console.log('updateShareButtonState: Disabled (no options checked)');
    }
  }

  // 添加控制提示显示的函数
  function updateTipVisibility(messageCount, chatFilesCount) {
    const $tip = $("#ccs-tip");
    if (messageCount <= 2 && chatFilesCount > 1) {
      $tip.show();
    } else {
      $tip.hide();
    }
  }

  async function updateStats() {
    if (DEBUG) console.log('Attempting to update stats...');
    const characterName = getCurrentCharacterName();
    $("#ccs-character").text(characterName);
    try {
      const stats = await getFullStats();
      if (DEBUG) console.log('Stats received in updateStats:', stats);

      const chatFilesCount = stats.chatFilesCount || 0;

      // 始终显示字数估算提示
      $("#ccs-tip").show();

      // 更新统计数据到UI
      $("#ccs-messages").text(stats.messageCount || 0);
      $("#ccs-words").text(stats.wordCount || 0);

      // Format total size dynamically (KB or MB)
      let formattedSize = '--';
      if (stats.totalSizeBytes !== undefined && stats.totalSizeBytes >= 0) {
        const bytes = stats.totalSizeBytes;
        const kb = bytes / 1024;
        const mb = kb / 1024;

        if (mb >= 1) {
          formattedSize = `${mb.toFixed(2)} MB`;
        } else if (kb >= 1) {
          formattedSize = `${kb.toFixed(2)} KB`;
        } else {
          formattedSize = `${bytes} B`; // Display bytes if less than 1 KB
        }
      }
      $("#ccs-total-size").text(formattedSize);


      if (!stats.firstTime) {
        if (DEBUG) console.log('No firstTime found in stats');
        $("#ccs-start").text("尚未互动");
        $("#ccs-days").text("0");
        // Pass messageCount even if firstTime is null
        updateShareButtonState(stats.messageCount);
      } else {
        const now = new Date();
        // Ensure stats.firstTime is a Date object
        const firstTimeDate = stats.firstTime instanceof Date ? stats.firstTime : new Date(stats.firstTime);
        if (DEBUG) console.log('First time date:', firstTimeDate);

        // 使用 UTC 日期来避免时区问题
        const utcNow = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const utcFirstTime = Date.UTC(firstTimeDate.getFullYear(), firstTimeDate.getMonth(), firstTimeDate.getDate());

        // 计算天数：从第一次互动到现在的天数（包括今天）
        const diffTime = Math.abs(utcNow - utcFirstTime);
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // 加1确保包括今天
        if (DEBUG) console.log('Calculated days:', days);

        // 格式化初遇时间
        const firstTimeFormatted = formatDateTime(stats.firstTime);
        if (DEBUG) console.log('Formatted first time:', firstTimeFormatted);

        $("#ccs-start").text(firstTimeFormatted);
        $("#ccs-days").text(days);
        // Pass messageCount to the state function
        updateShareButtonState(stats.messageCount);
      }
      // Removed the stray 'else' block that was here


      if (DEBUG) {
        console.log('Stats UI updated:', {
          messages: stats.messageCount,
          words: stats.wordCount,
          firstTime: stats.firstTime,
          days: $("#ccs-days").text()
        });
      }

    } catch (error) {
      console.error('更新统计数据失败:', error);
      // 显示错误状态
      $("#ccs-messages").text('--');
      $("#ccs-words").text('--');
      $("#ccs-start").text('--');
      $("#ccs-days").text('--');
      $("#ccs-total-size").text('--'); // Clear size on error too
      updateShareButtonState(0); // Pass 0 on error to ensure disabled state
    }
  }

  function getCharacterAvatar() {
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (!isUser) {
        const avatar = msg.querySelector('.avatar img');
        if (avatar) {
          return avatar.src;
        }
      }
    }
    return null;
  }

  function getUserAvatar() {
    // Priority 1: Try to get avatar from current chat messages
    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
      const isUser = msg.getAttribute('is_user') === 'true';
      if (isUser) {
        const avatar = msg.querySelector('.avatar img');
        if (avatar && avatar.src) {
          if (DEBUG) console.log("getUserAvatar: Found avatar in chat message.");
          return avatar.src;
        }
      }
    }

    // Priority 2 (Fallback): Try to get avatar from persona selection
    const userAvatarContainer = document.querySelector('.avatar-container[data-avatar-id="user-default.png"]');
    if (userAvatarContainer) {
      const avatar = userAvatarContainer.querySelector('img');
      if (avatar && avatar.src) {
        if (DEBUG) console.log("getUserAvatar: Found avatar in persona selection.");
        return avatar.src;
      }
    }

    if (DEBUG) console.log("getUserAvatar: Could not find user avatar.");
    return null; // Return null if not found in either place
  }

  async function generateShareImage() {
    const canvas = document.getElementById('ccs-canvas');
    const ctx = canvas.getContext('2d');
    const width = 1000;
    const height = 1300; // Slightly taller for cleaner spacing

    canvas.width = width;
    canvas.height = height;

    // 1. Instagram 风格背景 (极简白/浅灰)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. 加载头像数据
    const avatarUrl = getCharacterAvatar();
    const userAvatarUrl = getUserAvatar();

    const loadImg = (url) => new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

    const [charImg, userImg] = await Promise.all([loadImg(avatarUrl), loadImg(userAvatarUrl)]);

    // 绘制 Instagram 风格渐变环
    function drawInstagramRing(x, y, radius) {
      ctx.save();
      ctx.lineWidth = 8;
      const grad = ctx.createLinearGradient(x - radius, y + radius, x + radius, y - radius);
      grad.addColorStop(0, '#f09433');
      grad.addColorStop(0.25, '#e6683c');
      grad.addColorStop(0.5, '#dc2743');
      grad.addColorStop(0.75, '#cc2366');
      grad.addColorStop(1, '#bc1888');

      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawCircularAvatar(img, x, y, size) {
      const radius = size / 2;

      // 绘制 Ins 渐变环
      drawInstagramRing(x, y, radius);

      ctx.save();
      // 头像裁剪
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();

      if (img) {
        const scale = Math.max(size / img.width, size / img.height);
        const sw = img.width * scale;
        const sh = img.height * scale;
        ctx.drawImage(img, x - sw / 2, y - sh / 2, sw, sh);
      } else {
        ctx.fillStyle = '#f0f0f0';
        ctx.fill();
      }
      ctx.restore();

      // 白色分割细环 (Ins 风格特色)
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. 绘制头像区域 (居中对称)
    const showUser = $("#ccs-share-user-avatar").is(":checked") && userImg;
    const avatarSize = 240;
    const centerY = 320;

    if (showUser) {
      drawCircularAvatar(userImg, width / 2 - 180, centerY, avatarSize);
      drawCircularAvatar(charImg, width / 2 + 180, centerY, avatarSize);

      // 这里的“连接”在 Ins 风格中通常不需要图标，只要保持简洁
    } else {
      drawCircularAvatar(charImg, width / 2, centerY, avatarSize + 40);
    }

    // 4. 统计数据列表 (Ins 风格个人主页感)
    const stats = [
      { id: 'ccs-share-start', label: '初遇时间', value: $("#ccs-start").text() },
      { id: 'ccs-share-messages', label: '聊天对话', value: $("#ccs-messages").text(), unit: '条' },
      { id: 'ccs-share-words', label: '累计字数', value: $("#ccs-words").text(), unit: '字' },
      { id: 'ccs-share-days', label: '相伴天数', value: $("#ccs-days").text(), unit: '天' },
      { id: 'ccs-share-size', label: '回忆大小', value: $("#ccs-total-size").text() }
    ].filter(s => $(`#${s.id}`).is(":checked"));

    const listYStart = 550;
    const itemHeight = 120;
    const listWidth = 800;
    const listX = (width - listWidth) / 2;

    stats.forEach((stat, i) => {
      const y = listYStart + i * itemHeight;

      // 分割线
      if (i > 0) {
        ctx.strokeStyle = '#efefef';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(listX, y - 20);
        ctx.lineTo(listX + listWidth, y - 20);
        ctx.stroke();
      }

      // 标签 (Ins Secondary Text)
      ctx.textAlign = 'left';
      ctx.font = '32px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#8e8e8e'; // Ins grey info text
      ctx.fillText(stat.label, listX, y + 40);

      // 数值 (Ins Main Text)
      ctx.textAlign = 'right';
      ctx.font = '600 42px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#262626'; // Ins dark text
      const valStr = stat.value + (stat.unit || '');
      ctx.fillText(valStr, listX + listWidth, y + 45);
    });

    // 5. 顶部标题 (Ins 风格居中标题)
    ctx.textAlign = 'center';
    ctx.font = '600 48px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#262626';
    ctx.fillText('我们的羁绊回忆', width / 2, 120);

    // 6. 底部装饰 (仿 Ins 风格)
    ctx.font = '400 24px Arial';
    ctx.fillStyle = '#dbdbdb';
    ctx.fillText('━━━━  SHARED MOMENTS  ━━━━', width / 2, height - 80);

    return canvas.toDataURL('image/png');
  }

  function showPreview(imageData) {
    const $modal = $("#ccs-preview-modal");
    const $container = $("#ccs-preview-container");

    // 清空之前的内容
    $container.empty();

    // 创建预览图片
    const img = new Image();
    img.src = imageData;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.borderRadius = '5px';

    // 添加到容器
    $container.append(img);

    // 显示模态框
    $modal.css('display', 'flex');
  }

  // 添加刷新按钮事件处理
  $("#ccs-refresh").on("click", async function () {
    const $button = $(this);

    // 禁用按钮并显示更新中状态
    $button.prop('disabled', true).val('更新中...');

    try {
      // 更新统计
      await updateStats();

      // 显示更新成功状态
      $button.val('已更新');
    } catch (error) {
      console.error('更新统计数据失败:', error);
      $button.val('更新失败');
    } finally {
      // 恢复按钮状态
      setTimeout(() => {
        $button.prop('disabled', false).val('刷新');
      }, 800);
    }
  });

  // 添加分享按钮事件处理
  $("#ccs-share").on("click", async function () {
    const $button = $(this);
    if ($button.prop('disabled')) return; // 如果按钮被禁用，直接返回

    $button.prop('disabled', true).val('生成中...');

    try {
      const imageData = await generateShareImage();
      showPreview(imageData);
      $button.val('已生成');
    } catch (error) {
      console.error('生成分享图片失败:', error);
    } finally {
      setTimeout(() => {
        $button.prop('disabled', false).val('分享');
      }, 1000);
    }
  });

  // 添加取消按钮事件处理
  $("#ccs-cancel").on("click", function () {
    $("#ccs-preview-modal").hide();
  });

  // 添加保存按钮事件
  $("#ccs-download").on("click", function () {
    const characterName = getCurrentCharacterName();
    const link = document.createElement('a');
    link.download = `羁绊卡片_${characterName}.png`;
    link.href = $("#ccs-preview-container img").attr('src');
    link.click();
  });

  // 点击模态框背景关闭
  $("#ccs-preview-modal").on("click", function (e) {
    if (e.target === this) {
      $(this).hide();
    }
  });

  // Debounced update function
  const debouncedUpdateStats = debounce(updateStats, 500); // 500ms delay

  // 初始化时的基本更新
  updateStats(); // Keep initial update on load

  // Add change listener to checkboxes to update share button state
  $(document).on('change', '.ccs-share-option input[type="checkbox"]', function () {
    // Re-evaluate button state based on current message count whenever options change
    const currentMessageCount = parseInt($("#ccs-messages").text(), 10) || 0;
    updateShareButtonState(currentMessageCount);
  });

  // Observe character selection changes to trigger auto-refresh
  const selectedCharObserver = new MutationObserver((mutationsList) => {
    // Check if the mutations likely indicate a character change
    // A simple check is often enough, but could be refined if needed
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        if (DEBUG) console.log('Selected character change observed, triggering debounced update...');
        debouncedUpdateStats();
        return; // Only need to trigger once per batch of mutations
      }
    }
  });

  // Find the target element to observe - #rm_button_selected_ch seems appropriate
  const selectedCharElement = document.getElementById("rm_button_selected_ch");
  if (selectedCharElement) {
    if (DEBUG) console.log('Observing #rm_button_selected_ch for mutations.');
    // Observe changes to the children and subtree (like the h2 text changing)
    selectedCharObserver.observe(selectedCharElement, {
      childList: true,
      subtree: true,
      characterData: true // Observe text changes directly within nodes
    });
  } else {
    console.error('#rm_button_selected_ch element not found for MutationObserver.');
  }


  // // 定期更新 (Removed interval-based update)
  // setInterval(updateStats, 30000);

  if (DEBUG) console.log("✅ 聊天陪伴统计插件已加载 (自动刷新已启用)");
});
