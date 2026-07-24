import { useState, useEffect } from 'react';
import './ContributionCalendar.css';

// onDayClick: 日セルのクリックでその日に絞り込む(ImageGallery側でフィルタ)。selectedDate は選択中ハイライト用。
const ContributionCalendar = ({ images = [], onDayClick, selectedDate }) => {
  const [contributionData, setContributionData] = useState({});
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const extractTimestamp = (name) => {
    const m = name.match(/(\d{10,13})(?=\.[A-Za-z]+$)/);
    if (!m) return null;
    const num = Number(m[1]);
    return num > 1e12 ? Math.floor(num / 1000) : num; // 13桁→秒へ
  };

  const processImageData = () => {
    const contributions = {};
    
    images.forEach(imageName => {
      const timestamp = extractTimestamp(imageName);
      if (!timestamp) return;
      
      const date = new Date(timestamp * 1000);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      
      contributions[dateKey] = (contributions[dateKey] || 0) + 1;
    });
    
    setContributionData(contributions);
  };

  useEffect(() => {
    processImageData();
  }, [images]);

  const getContributionLevel = (count) => {
    if (!count) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    if (count <= 6) return 3;
    return 4;
  };

  const generateCalendarData = (year) => {
    const startDate = new Date(year, 0, 1); // 1月1日
    const endDate = new Date(year + 1, 0, 0); // 12月31日
    
    // 最初の日曜日を取得（GitHubスタイル）
    const firstSunday = new Date(startDate);
    firstSunday.setDate(startDate.getDate() - startDate.getDay());
    
    const weeks = [];
    let currentDate = new Date(firstSunday);
    
    while (currentDate <= endDate) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const dateKey = currentDate.toISOString().split('T')[0];
        const count = contributionData[dateKey] || 0;
        const level = getContributionLevel(count);
        
        week.push({
          date: new Date(currentDate),
          dateKey,
          count,
          level,
          isCurrentYear: currentDate.getFullYear() === year
        });
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      weeks.push(week);
    }
    
    return weeks;
  };

  const getAvailableYears = () => {
    const years = new Set();
    Object.keys(contributionData).forEach(dateKey => {
      const year = new Date(dateKey).getFullYear();
      years.add(year);
    });
    return Array.from(years).sort((a, b) => b - a);
  };

  const getTotalContributions = () => {
    return Object.values(contributionData).reduce((sum, count) => sum + count, 0);
  };

  const getYearContributions = (year) => {
    return Object.entries(contributionData)
      .filter(([dateKey]) => new Date(dateKey).getFullYear() === year)
      .reduce((sum, [, count]) => sum + count, 0);
  };

  const calendarData = generateCalendarData(selectedYear);
  const availableYears = getAvailableYears();
  const totalContributions = getTotalContributions();
  const yearContributions = getYearContributions(selectedYear);

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="contribution-calendar">
      <div className="calendar-header">
        <div className="stats">
          <span className="stat-item">
            <strong>{yearContributions}</strong> uploads in {selectedYear}
          </span>
          <span className="stat-item total">
            <strong>{totalContributions}</strong> total uploads
          </span>
        </div>
        
        {availableYears.length > 1 && (
          <select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="year-selector"
          >
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        )}
      </div>

      <div className="calendar-container">
        <div className="calendar-grid">
          {/* 月ラベル */}
          <div className="month-labels">
            {monthLabels.map((month, index) => (
              <span key={month} className="month-label" style={{
                gridColumn: `${Math.floor(index * 4.33) + 2} / span 4`
              }}>
                {month}
              </span>
            ))}
          </div>

          {/* 曜日ラベル */}
          <div className="day-labels">
            {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((day, index) => (
              <span key={index} className="day-label">
                {day}
              </span>
            ))}
          </div>

          {/* カレンダーグリッド */}
          <div className="weeks-container">
            {calendarData.map((week, weekIndex) => (
              <div key={weekIndex} className="week">
                {week.map((day, dayIndex) => (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    className={`day level-${day.level} ${!day.isCurrentYear ? 'outside-year' : ''} ${selectedDate === day.dateKey ? 'day-selected' : ''}`}
                    title={day.count > 0 ? `${day.count} uploads on ${day.dateKey}（クリックでこの日に絞り込み）` : `${day.count} uploads on ${day.dateKey}`}
                    data-count={day.count}
                    data-date={day.dateKey}
                    onClick={() => { if (day.count > 0 && onDayClick) onDayClick(day.dateKey); }}
                    style={day.count > 0 ? { cursor: 'pointer' } : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 凡例 */}
        <div className="legend">
          <span className="legend-text">Less</span>
          <div className="legend-levels">
            {[0, 1, 2, 3, 4].map(level => (
              <div key={level} className={`legend-day level-${level}`} />
            ))}
          </div>
          <span className="legend-text">More</span>
        </div>
      </div>
    </div>
  );
};

export default ContributionCalendar;