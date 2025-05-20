import styles from './styles.module.scss';

const BackgroundRays = () => {
  return (
    <div className={`${styles.rayContainer} `}>
      <div className={styles.neonBorder}></div>
      <div className={styles.neonGlow}></div>
    </div>
  );
};

export default BackgroundRays;
